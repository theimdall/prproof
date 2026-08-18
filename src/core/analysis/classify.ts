import type { Config } from '../config/schema.js';
import type { ChangedFile, DiffClassification } from '../model/context.js';
import { createMatcher, normalisePath } from './match.js';

/**
 * Extensions PRProof treats as "source code that a reviewer would expect tests
 * for". Workflow YAML, Dockerfiles and `.gitignore` are intentionally absent:
 * demanding a unit test for a CI tweak is exactly the kind of false positive
 * that gets a quality gate switched off.
 */
export const SOURCE_EXTENSIONS: readonly string[] = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'py',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'cs',
  'rb',
  'php',
  'swift',
  'm',
  'mm',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cxx',
  'scala',
  'ex',
  'exs',
  'dart',
  'vue',
  'svelte',
  'erl',
  'clj',
  'lua',
  'zig',
];

export type FileCategory = 'lock' | 'dependency' | 'documentation' | 'test' | 'source' | 'other';

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/**
 * Classifies a single path.
 *
 * Precedence is fixed and deliberate: lock files and dependency manifests win
 * over documentation, because `requirements.txt` would otherwise be swallowed
 * by a broad documentation pattern; documentation wins over tests so that
 * `tests/README.md` does not count as a test change.
 */
export function classifyPath(path: string, config: Config): FileCategory {
  const isLock = createMatcher(config.dependencies.lockPatterns);
  const isManifest = createMatcher(config.dependencies.manifestPatterns);
  const isDoc = createMatcher(config.documentationOnly.patterns);
  const isTest = createMatcher(config.tests.patterns);
  return classifyWith(path, { isLock, isManifest, isDoc, isTest });
}

interface Matchers {
  isLock: (path: string) => boolean;
  isManifest: (path: string) => boolean;
  isDoc: (path: string) => boolean;
  isTest: (path: string) => boolean;
}

function classifyWith(rawPath: string, matchers: Matchers): FileCategory {
  const path = normalisePath(rawPath);
  if (matchers.isLock(path)) return 'lock';
  if (matchers.isManifest(path)) return 'dependency';
  if (matchers.isDoc(path)) return 'documentation';
  if (matchers.isTest(path)) return 'test';
  if (SOURCE_EXTENSIONS.includes(extensionOf(path))) return 'source';
  return 'other';
}

/** Splits the changed files of a pull request into the categories rules use. */
export function classifyDiff(files: readonly ChangedFile[], config: Config): DiffClassification {
  const isExcluded = createMatcher(config.limits.exclude);
  const matchers: Matchers = {
    isLock: createMatcher(config.dependencies.lockPatterns),
    isManifest: createMatcher(config.dependencies.manifestPatterns),
    isDoc: createMatcher(config.documentationOnly.patterns),
    isTest: createMatcher(config.tests.patterns),
  };

  const sourceFiles: string[] = [];
  const testFiles: string[] = [];
  const documentationFiles: string[] = [];
  const dependencyFiles: string[] = [];
  const lockFiles: string[] = [];
  const otherFiles: string[] = [];
  const excludedFiles: string[] = [];

  for (const file of files) {
    const path = normalisePath(file.path);
    const category = classifyWith(path, matchers);

    // Excluded files keep their identity — a lock file is still a lock file for
    // DEP001 — but they are not source anyone should write a test for, and they
    // do not count towards size.
    if (isExcluded(path)) {
      excludedFiles.push(path);
      if (category === 'source' || category === 'test') continue;
    }

    switch (category) {
      case 'lock':
        lockFiles.push(path);
        break;
      case 'dependency':
        dependencyFiles.push(path);
        break;
      case 'documentation':
        documentationFiles.push(path);
        break;
      case 'test':
        testFiles.push(path);
        break;
      case 'source':
        sourceFiles.push(path);
        break;
      case 'other':
        otherFiles.push(path);
        break;
    }
  }

  return {
    sourceFiles,
    testFiles,
    documentationFiles,
    dependencyFiles,
    lockFiles,
    otherFiles,
    excludedFiles,
    // Measured against the files that count, so a documentation change that
    // also refreshes a lock file is still documentation-only.
    documentationOnly:
      documentationFiles.length > 0 && documentationFiles.length === files.length - excludedFiles.length,
  };
}
