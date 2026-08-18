import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  guessBaseBranch,
  isGitRepository,
  loadGitDiff,
  mergeBase,
  readFileAtRef,
  readLocalHead,
} from '../../src/adapters/diff/git.js';
import { collectManifestSnapshots, manifestPathsIn } from '../../src/adapters/diff/manifests.js';
import { analyseDependencies } from '../../src/core/analysis/dependencies.js';
import { DEFAULT_CONFIG } from '../../src/core/config/schema.js';

const run = promisify(execFile);

/**
 * Exercises the git adapter against a real repository.
 *
 * The parsing functions have unit tests, but the part that actually matters —
 * that PRProof asks git the right questions and understands the answers — can
 * only be verified against git itself.
 */
describe('git adapter, against a real repository', () => {
  let repo: string;

  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await run('git', args, { cwd: repo });
    return stdout;
  };

  beforeAll(async () => {
    repo = await mkdtemp(path.join(tmpdir(), 'prproof-git-'));

    await git('init', '--quiet', '--initial-branch=main');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');

    await mkdir(path.join(repo, 'src'), { recursive: true });
    await writeFile(path.join(repo, 'src', 'session.ts'), 'export const a = 1;\n');
    await writeFile(
      path.join(repo, 'package.json'),
      `${JSON.stringify({ name: 'demo', dependencies: { express: '^4.18.2' } }, null, 2)}\n`,
    );
    await git('add', '-A');
    await git('commit', '--quiet', '-m', 'base');

    await git('checkout', '--quiet', '-b', 'feature');
    await writeFile(path.join(repo, 'src', 'session.ts'), 'export const a = 1;\nexport const b = 2;\n');
    await writeFile(path.join(repo, 'src', 'new.ts'), 'export const c = 3;\n');
    await writeFile(
      path.join(repo, 'package.json'),
      `${JSON.stringify({ name: 'demo', dependencies: { express: '^4.18.2', axios: '^1.6.2' } }, null, 2)}\n`,
    );
    await git('rm', '--quiet', '-f', 'src/session.ts');
    await writeFile(path.join(repo, 'src', 'renamed.ts'), 'export const a = 1;\nexport const b = 2;\n');
    await git('add', '-A');
    await git('commit', '--quiet', '-m', 'feature work');
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('recognises a git repository', async () => {
    expect(await isGitRepository(repo)).toBe(true);
    expect(await isGitRepository(tmpdir())).toBe(false);
  });

  it('resolves the merge base', async () => {
    const sha = await mergeBase('main', 'HEAD', repo);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('reads the changed files with counts and statuses', async () => {
    const diff = await loadGitDiff({ cwd: repo, base: 'main', head: 'HEAD' });
    const paths = diff.files.map((file) => file.path).sort();

    expect(paths).toContain('src/new.ts');
    expect(paths).toContain('package.json');
    expect(diff.changedFiles).toBe(diff.files.length);
    expect(diff.additions).toBeGreaterThan(0);
    expect(diff.truncated).toBe(false);

    const added = diff.files.find((file) => file.path === 'src/new.ts');
    expect(added?.status).toBe('added');
    expect(added?.additions).toBe(1);
  });

  it('fetches patches only for the files that were asked for', async () => {
    const diff = await loadGitDiff({
      cwd: repo,
      base: 'main',
      head: 'HEAD',
      patchFilter: (file) => file === 'package.json',
    });
    expect(diff.files.find((file) => file.path === 'package.json')?.patch).toContain('axios');
    expect(diff.files.find((file) => file.path === 'src/new.ts')?.patch).toBeUndefined();
  });

  it('reads a file at a revision, and reports a missing one as null', async () => {
    expect(await readFileAtRef(repo, 'main', 'package.json')).toContain('express');
    expect(await readFileAtRef(repo, 'main', 'src/new.ts')).toBeNull();
    expect(await readFileAtRef(repo, 'HEAD', 'src/new.ts')).toContain('export const c');
  });

  it('reads local head metadata', async () => {
    const head = await readLocalHead(repo);
    expect(head.branch).toBe('feature');
    expect(head.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(head.subject).toBe('feature work');
  });

  it('falls back to a local default branch when there is no remote', async () => {
    expect(await guessBaseBranch(repo)).toBe('main');
  });

  it('finds the new dependency end to end, from git to the report', async () => {
    const diff = await loadGitDiff({ cwd: repo, base: 'main', head: 'HEAD' });
    const base = await mergeBase('main', 'HEAD', repo);

    expect(manifestPathsIn(diff.files, DEFAULT_CONFIG)).toEqual(['package.json']);

    const snapshots = await collectManifestSnapshots(diff.files, DEFAULT_CONFIG, (file, ref) =>
      readFileAtRef(repo, ref === 'base' ? base : 'HEAD', file),
    );
    const report = analyseDependencies(diff.files, DEFAULT_CONFIG, snapshots);

    expect(report.added.map((entry) => entry.name)).toEqual(['axios']);
    expect(report.incomplete).toBe(false);
  });
});
