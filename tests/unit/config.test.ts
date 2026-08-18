import { describe, expect, it } from 'vitest';

import { parseConfigText, MAX_CONFIG_BYTES } from '../../src/core/config/load.js';
import { ConfigError, parseConfig } from '../../src/core/config/validate.js';
import { DEFAULT_CONFIG } from '../../src/core/config/schema.js';

function expectIssues(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('configuration', () => {
  it('uses defaults for an empty document', () => {
    expect(parseConfigText('', '.prproof.yml')).toEqual(DEFAULT_CONFIG);
  });

  it('reads a realistic configuration', () => {
    const config = parseConfigText(
      `version: 1
mode: run
build:
  command: npm run build
  required: true
test:
  command: npm test
lint:
  command: npm run lint
  required: false
limits:
  max_changed_files: 30
  max_changed_lines: 1500
tests:
  require_test_changes: false
pull_request:
  minimum_description_length: 80
  require_issue_reference: true
duplicate_detection:
  enabled: false
fail_on:
  - critical
  - high
`,
      '.prproof.yml',
    );

    expect(config.mode).toBe('run');
    expect(config.checks.build.command).toBe('npm run build');
    expect(config.checks.lint.required).toBe(false);
    expect(config.limits.maxChangedFiles).toBe(30);
    expect(config.tests.requireTestChanges).toBe(false);
    expect(config.pullRequest.minimumDescriptionLength).toBe(80);
    expect(config.duplicateDetection.enabled).toBe(false);
    expect(config.failOn).toEqual(['critical', 'high']);
  });

  it('rejects unknown keys instead of ignoring them', () => {
    const error = expectIssues(() => parseConfig({ tests: { require_tests: true } }));
    expect(error.issues[0]?.path).toBe('tests.require_tests');
  });

  it('reports every problem at once', () => {
    const error = expectIssues(() =>
      parseConfig({
        limits: { max_changed_files: 'twenty' },
        pull_request: { minimum_description_length: -5 },
        fail_on: ['catastrophic'],
      }),
    );
    expect(error.issues).toHaveLength(3);
  });

  it('rejects an unknown rule id in scoring weights', () => {
    const error = expectIssues(() => parseConfig({ scoring: { weights: { NOPE001: 5 } } }));
    expect(error.issues[0]?.path).toBe('scoring.weights.NOPE001');
  });

  it('rejects YAML anchors', () => {
    const document = `version: 1
tests: &anchor
  require_test_changes: true
pull_request: *anchor
`;
    expect(() => parseConfigText(document, '.prproof.yml')).toThrow(ConfigError);
  });

  it('rejects an oversized file', () => {
    const document = `# ${'x'.repeat(MAX_CONFIG_BYTES + 1)}`;
    expect(() => parseConfigText(document, '.prproof.yml')).toThrow(/limit is/);
  });

  it('reports malformed YAML as a configuration error', () => {
    expect(() => parseConfigText('version: 1\n  bad: [', '.prproof.yml')).toThrow(ConfigError);
  });
});
