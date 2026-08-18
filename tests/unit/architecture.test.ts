import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../../src');

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    }),
  );
  return files.flat();
}

async function importsOf(file: string): Promise<string[]> {
  const source = await readFile(file, 'utf8');
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
}

/**
 * The layering rule, enforced rather than described.
 *
 * `core` is the part of PRProof that a future CLI, GitHub App or GitLab port
 * would reuse unchanged. That is only true for as long as it stays free of
 * network access, subprocesses, the file system and the Actions toolkit — and
 * a comment in the README has never stopped an import.
 */
describe('architecture', () => {
  const forbiddenInCore = [
    '@actions/core',
    '@actions/github',
    '@actions/artifact',
    '@octokit',
    'node:child_process',
    'node:fs',
    'node:fs/promises',
    'node:http',
    'node:https',
    'node:net',
  ];

  it('keeps src/core free of I/O and the Actions toolkit', async () => {
    const files = await filesUnder(path.join(SRC, 'core'));
    expect(files.length).toBeGreaterThan(10);

    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of await importsOf(file)) {
        if (forbiddenInCore.some((banned) => specifier === banned || specifier.startsWith(`${banned}/`))) {
          violations.push(`${path.relative(SRC, file)} imports ${specifier}`);
        }
        if (
          specifier.includes('../../adapters') ||
          specifier.includes('../../github') ||
          specifier.includes('../../action')
        ) {
          violations.push(`${path.relative(SRC, file)} imports outward: ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps adapters independent of the GitHub and action layers', async () => {
    const files = await filesUnder(path.join(SRC, 'adapters'));
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of await importsOf(file)) {
        if (
          specifier.includes('/github/') ||
          specifier.includes('/action/') ||
          specifier.startsWith('@actions/')
        ) {
          violations.push(`${path.relative(SRC, file)} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('uses explicit .js specifiers for every relative import', async () => {
    const files = await filesUnder(SRC);
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of await importsOf(file)) {
        if (specifier.startsWith('.') && !specifier.endsWith('.js')) {
          violations.push(`${path.relative(SRC, file)} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
