import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ChangedFile, DiffSummary, FileChangeStatus } from '../../core/model/context.js';
import { normalisePath } from '../../core/analysis/match.js';

const execFileAsync = promisify(execFile);

/** Upper bound on manifest patches fetched for dependency analysis. */
const MAX_PATCH_FILES = 25;
const MAX_BUFFER = 32 * 1024 * 1024;

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

/** Runs git with an explicit argv — never through a shell. */
async function git(args: readonly string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8',
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitError(`git ${args.join(' ')} failed: ${message}`);
  }
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--git-dir'], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the point the branch diverged from its base, so the diff shows the
 * work of this branch rather than everything that landed on the base since.
 * This is the same semantics as GitHub's "Files changed" tab.
 */
export async function mergeBase(base: string, head: string, cwd: string): Promise<string> {
  const output = await git(['merge-base', base, head], cwd);
  const sha = output.trim();
  if (sha === '') throw new GitError(`no common ancestor between ${base} and ${head}`);
  return sha;
}

function parseStatusLetter(letter: string): FileChangeStatus {
  switch (letter[0]) {
    case 'A':
      return 'added';
    case 'D':
      return 'removed';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'M':
      return 'modified';
    default:
      return 'changed';
  }
}

/** Parses `git diff --name-status -z`, which NUL-separates every field. */
export function parseNameStatus(
  output: string,
): Map<string, { status: FileChangeStatus; previousPath?: string }> {
  const result = new Map<string, { status: FileChangeStatus; previousPath?: string }>();
  const tokens = output.split('\0').filter((token) => token !== '');
  let index = 0;
  while (index < tokens.length) {
    const letter = tokens[index];
    index += 1;
    if (letter === undefined) break;
    if (letter.startsWith('R') || letter.startsWith('C')) {
      const from = tokens[index];
      const to = tokens[index + 1];
      index += 2;
      if (to === undefined) break;
      result.set(normalisePath(to), {
        status: parseStatusLetter(letter),
        ...(from === undefined ? {} : { previousPath: normalisePath(from) }),
      });
      continue;
    }
    const file = tokens[index];
    index += 1;
    if (file === undefined) break;
    result.set(normalisePath(file), { status: parseStatusLetter(letter) });
  }
  return result;
}

/** Parses `git diff --numstat -z`. Binary files report `-` counts. */
export function parseNumstat(output: string): { path: string; additions: number; deletions: number }[] {
  const tokens = output.split('\0').filter((token) => token !== '');
  const entries: { path: string; additions: number; deletions: number }[] = [];
  let index = 0;

  while (index < tokens.length) {
    const entry = tokens[index];
    index += 1;
    if (entry === undefined) continue;

    const parts = entry.split('\t');
    const additions = toCount(parts[0]);
    const deletions = toCount(parts[1]);
    const inlinePath = parts[2];

    if (inlinePath === undefined || inlinePath === '') {
      // Rename or copy: the two paths follow as separate NUL-terminated fields.
      const to = tokens[index + 1];
      index += 2;
      if (to === undefined) break;
      entries.push({ path: normalisePath(to), additions, deletions });
      continue;
    }
    entries.push({ path: normalisePath(inlinePath), additions, deletions });
  }
  return entries;
}

function toCount(value: string | undefined): number {
  if (value === undefined || value === '-') return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Splits a multi-file unified diff into per-path patches. */
export function splitPatches(diff: string): Map<string, string> {
  const patches = new Map<string, string>();
  const sections = diff.split(/^diff --git /m).slice(1);
  for (const section of sections) {
    const header = section.split('\n', 1)[0] ?? '';
    const match = /b\/(.+)$/.exec(header.trim());
    if (!match) continue;
    const path = normalisePath(match[1] ?? '');
    if (path === '') continue;
    patches.set(path, section);
  }
  return patches;
}

export interface GitDiffOptions {
  readonly cwd: string;
  readonly base: string;
  readonly head: string;
  /** Selects the files whose patch text is needed (dependency manifests). */
  readonly patchFilter?: (path: string) => boolean;
}

/**
 * Builds a diff summary from a local repository, for `prproof analyze`.
 *
 * Patches are fetched only for the handful of files the dependency analyser
 * actually reads. Materialising every hunk of a large branch would cost
 * seconds and buy nothing.
 */
export async function loadGitDiff(options: GitDiffOptions): Promise<DiffSummary> {
  const { cwd, head } = options;
  const base = await mergeBase(options.base, head, cwd);

  const [numstat, nameStatus] = await Promise.all([
    git(['diff', '--numstat', '-z', '--find-renames', base, head], cwd),
    git(['diff', '--name-status', '-z', '--find-renames', base, head], cwd),
  ]);

  const counts = parseNumstat(numstat);
  const statuses = parseNameStatus(nameStatus);

  const wanted = options.patchFilter ?? (() => false);
  const patchTargets = counts
    .map((entry) => entry.path)
    .filter((path) => wanted(path))
    .slice(0, MAX_PATCH_FILES);

  let patches = new Map<string, string>();
  if (patchTargets.length > 0) {
    const diff = await git(['diff', '--unified=3', base, head, '--', ...patchTargets], cwd);
    patches = splitPatches(diff);
  }

  const files: ChangedFile[] = counts.map((entry) => {
    const meta = statuses.get(entry.path);
    const patch = patches.get(entry.path);
    return {
      path: entry.path,
      status: meta?.status ?? 'changed',
      additions: entry.additions,
      deletions: entry.deletions,
      ...(meta?.previousPath === undefined ? {} : { previousPath: meta.previousPath }),
      ...(patch === undefined ? {} : { patch }),
    };
  });

  return {
    files,
    changedFiles: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    truncated: false,
  };
}

/** Reads a file as it exists at a revision, or null when it is not there. */
export async function readFileAtRef(cwd: string, ref: string, filePath: string): Promise<string | null> {
  try {
    return await git(['show', `${ref}:${filePath}`], cwd);
  } catch {
    return null;
  }
}

export interface LocalHead {
  readonly branch: string;
  readonly sha: string;
  readonly subject: string;
  readonly body: string;
}

/** Reads local branch metadata, used to stand in for pull request fields. */
export async function readLocalHead(cwd: string): Promise<LocalHead> {
  const [branch, sha, subject, body] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    git(['rev-parse', 'HEAD'], cwd),
    git(['log', '-1', '--pretty=%s'], cwd),
    git(['log', '-1', '--pretty=%b'], cwd),
  ]);
  return {
    branch: branch.trim(),
    sha: sha.trim(),
    subject: subject.trim(),
    body: body.trim(),
  };
}

/** Best-effort guess at the default branch, used when `--base` is omitted. */
export async function guessBaseBranch(cwd: string): Promise<string> {
  for (const candidate of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
    try {
      const output = await git(['rev-parse', '--abbrev-ref', candidate], cwd);
      const resolved = output.trim();
      if (resolved !== '') return resolved;
    } catch {
      continue;
    }
  }
  throw new GitError('could not determine a base branch; pass --base explicitly');
}
