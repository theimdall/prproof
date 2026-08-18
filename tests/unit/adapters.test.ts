import { describe, expect, it } from 'vitest';

import { parseNameStatus, parseNumstat, splitPatches } from '../../src/adapters/diff/git.js';
import {
  resolveChecks,
  statusFromCheckRun,
  statusFromStepOutcome,
} from '../../src/adapters/checks/resolve.js';
import { tailOf } from '../../src/adapters/exec/command.js';
import { config } from '../fixtures/context.js';

describe('git output parsing', () => {
  it('parses numstat with NUL separators', () => {
    const output = '12\t3\tsrc/a.ts\u000045\t6\tsrc/b.ts\u0000';
    expect(parseNumstat(output)).toEqual([
      { path: 'src/a.ts', additions: 12, deletions: 3 },
      { path: 'src/b.ts', additions: 45, deletions: 6 },
    ]);
  });

  it('parses renames, where the paths follow as separate fields', () => {
    const output = '1\t1\t\u0000src/old.ts\u0000src/new.ts\u0000';
    expect(parseNumstat(output)).toEqual([{ path: 'src/new.ts', additions: 1, deletions: 1 }]);
  });

  it('treats binary files as zero lines', () => {
    expect(parseNumstat('-\t-\tlogo.png\u0000')).toEqual([{ path: 'logo.png', additions: 0, deletions: 0 }]);
  });

  it('parses name-status including renames', () => {
    const statuses = parseNameStatus('M\u0000src/a.ts\u0000R100\u0000src/old.ts\u0000src/new.ts\u0000');
    expect(statuses.get('src/a.ts')).toEqual({ status: 'modified' });
    expect(statuses.get('src/new.ts')).toEqual({ status: 'renamed', previousPath: 'src/old.ts' });
  });

  it('splits a multi-file diff per path', () => {
    const diff = [
      'diff --git a/package.json b/package.json',
      '@@ -1 +1 @@',
      '+  "axios": "^1.6.2"',
      'diff --git a/go.mod b/go.mod',
      '@@ -1 +1 @@',
      '+require example.com/x v1.0.0',
    ].join('\n');
    const patches = splitPatches(diff);
    expect([...patches.keys()]).toEqual(['package.json', 'go.mod']);
    expect(patches.get('package.json')).toContain('axios');
  });
});

describe('check outcome mapping', () => {
  it.each([
    ['success', 'passed'],
    ['failure', 'failed'],
    ['skipped', 'skipped'],
    ['cancelled', 'unknown'],
    ['', 'unknown'],
  ])('maps step outcome %s to %s', (outcome, expected) => {
    expect(statusFromStepOutcome(outcome)).toBe(expected);
  });

  it.each([
    [{ name: 'ci', status: 'completed', conclusion: 'success' }, 'passed'],
    [{ name: 'ci', status: 'completed', conclusion: 'neutral' }, 'passed'],
    [{ name: 'ci', status: 'completed', conclusion: 'failure' }, 'failed'],
    [{ name: 'ci', status: 'completed', conclusion: 'timed_out' }, 'failed'],
    [{ name: 'ci', status: 'completed', conclusion: 'skipped' }, 'skipped'],
    [{ name: 'ci', status: 'in_progress', conclusion: null }, 'unknown'],
  ])('maps check run %o to %s', (run, expected) => {
    expect(statusFromCheckRun(run)).toBe(expected);
  });
});

describe('check resolution', () => {
  it('prefers workflow-reported outcomes over everything else', async () => {
    const checks = await resolveChecks({
      config: config({ checks: { build: { checkName: 'ci' } } }),
      inputs: { build: 'success' },
      checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'failure' }],
      execution: null,
      notes: [],
    });
    const build = checks.find((check) => check.kind === 'build');
    expect(build?.status).toBe('passed');
    expect(build?.source).toBe('input');
  });

  it('falls back to a named check run', async () => {
    const checks = await resolveChecks({
      config: config({ checks: { test: { checkName: 'unit tests' } } }),
      inputs: {},
      checkRuns: [{ name: 'unit tests', status: 'completed', conclusion: 'failure' }],
      execution: null,
      notes: [],
    });
    expect(checks.find((check) => check.kind === 'test')?.status).toBe('failed');
  });

  it('says so when a configured check run is missing', async () => {
    const checks = await resolveChecks({
      config: config({ checks: { test: { checkName: 'unit tests' } } }),
      inputs: {},
      checkRuns: [],
      execution: null,
      notes: [],
    });
    const test = checks.find((check) => check.kind === 'test');
    expect(test?.status).toBe('unknown');
    expect(test?.detail).toContain('unit tests');
  });

  it('reports nothing configured rather than guessing', async () => {
    const checks = await resolveChecks({
      config: config(),
      inputs: {},
      checkRuns: null,
      execution: null,
      notes: [],
    });
    expect(checks.every((check) => check.source === 'not-configured')).toBe(true);
  });

  it('refuses to execute commands in a privileged event and does not score it as a failure', async () => {
    const notes: string[] = [];
    const checks = await resolveChecks({
      config: config({ mode: 'run', checks: { build: { command: 'npm run build' } } }),
      inputs: {},
      checkRuns: null,
      execution: { workspace: process.cwd(), eventName: 'pull_request_target' },
      notes,
    });
    const build = checks.find((check) => check.kind === 'build');
    expect(build?.status).toBe('unknown');
    expect(notes.join(' ')).toContain('pull_request_target');
  });

  it('refuses a command that is not on the allowlist', async () => {
    const notes: string[] = [];
    await resolveChecks({
      config: config({ mode: 'run', checks: { build: { command: 'bash -c id' } } }),
      inputs: {},
      checkRuns: null,
      execution: { workspace: process.cwd(), eventName: 'pull_request' },
      notes,
    });
    expect(notes.join(' ')).toContain('allowed_commands');
  });

  it('runs a real command and reports the exit code', async () => {
    const checks = await resolveChecks({
      config: config({
        mode: 'run',
        checks: { test: { command: 'node -e 0' } },
        run: { timeoutSeconds: 30 },
      }),
      inputs: {},
      checkRuns: null,
      execution: { workspace: process.cwd(), eventName: 'pull_request' },
      notes: [],
    });
    const test = checks.find((check) => check.kind === 'test');
    expect(test?.source).toBe('run');
    expect(test?.status).toBe('passed');
  });
});

describe('command output handling', () => {
  it('keeps only the last lines and redacts them', () => {
    const output = ['a', 'b', 'token=ghp_abcdefghijklmnopqrstuvwxyz012345', ''].join('\n');
    const tail = tailOf(output, 2);
    expect(tail).toHaveLength(2);
    expect(tail.join(' ')).not.toContain('ghp_abcdefghij');
  });

  it('caps very long lines', () => {
    expect(tailOf('x'.repeat(1000), 1)[0]?.length).toBeLessThanOrEqual(200);
  });
});
