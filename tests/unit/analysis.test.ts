import { describe, expect, it } from 'vitest';

import { classifyDiff, classifyPath } from '../../src/core/analysis/classify.js';
import { analyseDependencies, readPatch } from '../../src/core/analysis/dependencies.js';
import { findDuplicates, jaccard } from '../../src/core/analysis/duplicates.js';
import { extractIssueReferences, stripCode } from '../../src/core/analysis/issues.js';
import { DEFAULT_CONFIG } from '../../src/core/config/schema.js';
import { config, file, openPullRequest } from '../fixtures/context.js';

describe('file classification', () => {
  it.each([
    ['src/session.ts', 'source'],
    ['src/session.test.ts', 'test'],
    ['tests/e2e/login.ts', 'test'],
    ['api/tests/test_login.py', 'test'],
    ['pkg/store/store_test.go', 'test'],
    ['README.md', 'documentation'],
    ['docs/guide.md', 'documentation'],
    ['LICENSE', 'documentation'],
    ['package.json', 'dependency'],
    ['requirements.txt', 'dependency'],
    ['package-lock.json', 'lock'],
    ['go.sum', 'lock'],
    ['.github/workflows/ci.yml', 'other'],
    ['Dockerfile', 'other'],
  ])('classifies %s as %s', (path, expected) => {
    expect(classifyPath(path, DEFAULT_CONFIG)).toBe(expected);
  });

  it('keeps requirements.txt a manifest even though documentation patterns are broad', () => {
    expect(classifyPath('requirements.txt', DEFAULT_CONFIG)).toBe('dependency');
  });

  it('does not treat tests/README.md as a test change', () => {
    expect(classifyPath('tests/README.md', DEFAULT_CONFIG)).toBe('documentation');
  });

  it('detects a documentation-only pull request', () => {
    const result = classifyDiff([file('README.md'), file('docs/a.md')], DEFAULT_CONFIG);
    expect(result.documentationOnly).toBe(true);
  });

  it('does not call a mixed pull request documentation-only', () => {
    const result = classifyDiff([file('README.md'), file('src/a.ts')], DEFAULT_CONFIG);
    expect(result.documentationOnly).toBe(false);
  });

  it('normalises Windows separators', () => {
    expect(classifyPath('src\\session.test.ts', DEFAULT_CONFIG)).toBe('test');
  });
});

describe('dependency analysis', () => {
  const cfg = config();

  function analyse(path: string, patch: string) {
    return analyseDependencies([file(path, { patch })], cfg);
  }

  it('reads added npm dependencies and ignores the package name', () => {
    const patch = [
      ' {',
      '   "name": "widgets",',
      '   "dependencies": {',
      '+    "axios": "^1.6.2",',
      '     "express": "^4.18.2"',
      '   },',
      '   "devDependencies": {',
      '+    "vitest": "^3.0.0"',
      '   }',
      ' }',
    ].join('\n');
    const report = analyse('package.json', patch);
    expect(report.added.map((entry) => entry.name)).toEqual(['axios', 'vitest']);
    expect(report.added[0]?.kind).toBe('runtime');
    expect(report.added[1]?.kind).toBe('development');
    expect(report.incomplete).toBe(false);
  });

  it('treats a version bump as an update, not an addition', () => {
    const patch = ['   "dependencies": {', '-    "axios": "^1.5.0"', '+    "axios": "^1.6.2"', '   }'].join(
      '\n',
    );
    const report = analyse('package.json', patch);
    expect(report.added).toHaveLength(0);
    expect(report.updated.map((entry) => entry.name)).toEqual(['axios']);
  });

  it('reads requirements.txt', () => {
    const report = analyse('requirements.txt', '+requests>=2.31.0\n+# a comment\n+-r other.txt');
    expect(report.added.map((entry) => entry.name)).toEqual(['requests']);
  });

  it('reads go.mod', () => {
    const report = analyse('go.mod', '+\tgithub.com/stretchr/testify v1.9.0');
    expect(report.added[0]?.name).toBe('github.com/stretchr/testify');
    expect(report.added[0]?.version).toBe('v1.9.0');
  });

  it('reads Cargo.toml sections', () => {
    const patch = ['[dependencies]', '+serde = "1.0"', '[dev-dependencies]', '+proptest = "1"'].join('\n');
    const report = analyse('Cargo.toml', patch);
    expect(report.added.map((entry) => `${entry.name}:${entry.kind}`)).toEqual([
      'serde:runtime',
      'proptest:development',
    ]);
  });

  it('marks unparsable manifests as incomplete instead of clean', () => {
    const report = analyse('pom.xml', '+<artifactId>guava</artifactId>');
    expect(report.incomplete).toBe(true);
    expect(report.added).toHaveLength(0);
  });

  it('marks a manifest with no patch as incomplete', () => {
    const report = analyseDependencies([file('package.json')], cfg);
    expect(report.incomplete).toBe(true);
  });

  it('records lock files without mining them', () => {
    const report = analyseDependencies([file('pnpm-lock.yaml', { patch: '+  axios: 1.6.2' })], cfg);
    expect(report.lockFilesChanged).toEqual(['pnpm-lock.yaml']);
    expect(report.added).toHaveLength(0);
    expect(report.incomplete).toBe(false);
  });

  it('finds an addition the diff context cannot show', () => {
    // The regression this rule exists for: in a real package.json the
    // `"dependencies": {` header is far above the changed line, so three lines
    // of diff context never contain it and patch parsing alone reports nothing.
    const before = JSON.stringify(
      { name: 'app', dependencies: { a: '^1', b: '^2', c: '^3', d: '^4', e: '^5' } },
      null,
      2,
    );
    const after = JSON.stringify(
      { name: 'app', dependencies: { a: '^1', b: '^2', c: '^3', d: '^4', e: '^5', axios: '^1.6.2' } },
      null,
      2,
    );
    const patch = [
      '@@ -6,5 +6,6 @@',
      '     "d": "^4",',
      '-    "e": "^5"',
      '+    "e": "^5",',
      '+    "axios": "^1.6.2"',
      '   }',
    ].join('\n');

    const withPatchOnly = analyseDependencies([file('package.json', { patch })], cfg);
    expect(withPatchOnly.added).toHaveLength(0);
    expect(withPatchOnly.incomplete).toBe(true);

    const withSnapshot = analyseDependencies(
      [file('package.json', { patch })],
      cfg,
      new Map([['package.json', { before, after }]]),
    );
    expect(withSnapshot.added.map((entry) => entry.name)).toEqual(['axios']);
    expect(withSnapshot.incomplete).toBe(false);
  });

  it('treats a new manifest as all-new dependencies', () => {
    const after = JSON.stringify({ dependencies: { axios: '^1.6.2' } }, null, 2);
    const report = analyseDependencies(
      [file('package.json', { status: 'added' })],
      cfg,
      new Map([['package.json', { before: null, after }]]),
    );
    expect(report.added.map((entry) => entry.name)).toEqual(['axios']);
  });

  it('separates additions from version bumps using both snapshots', () => {
    const before = JSON.stringify({ dependencies: { axios: '^1.5.0' } }, null, 2);
    const after = JSON.stringify({ dependencies: { axios: '^1.6.2', zod: '^3' } }, null, 2);
    const report = analyseDependencies(
      [file('package.json')],
      cfg,
      new Map([['package.json', { before, after }]]),
    );
    expect(report.added.map((entry) => entry.name)).toEqual(['zod']);
    expect(report.updated.map((entry) => entry.name)).toEqual(['axios']);
  });

  it('parses unified diff lines', () => {
    const lines = readPatch('@@ -1 +1 @@\n-old\n+new\n context');
    expect(lines).toEqual([
      { kind: 'removed', text: 'old' },
      { kind: 'added', text: 'new' },
      { kind: 'context', text: 'context' },
    ]);
  });
});

describe('duplicate detection', () => {
  const cfg = DEFAULT_CONFIG.duplicateDetection;
  const subject = {
    number: 10,
    baseRef: 'main',
    headRef: 'feature/a',
    files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
    linkedIssues: [] as number[],
  };

  it('computes Jaccard similarity', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });

  it('finds heavy overlap', () => {
    const candidates = findDuplicates(subject, [openPullRequest({ files: [...subject.files] })], cfg);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.reason).toBe('shared-files');
  });

  it('ignores light overlap', () => {
    const candidates = findDuplicates(
      subject,
      [openPullRequest({ files: ['src/a.ts', 'x.ts', 'y.ts', 'z.ts', 'w.ts'] })],
      cfg,
    );
    expect(candidates).toHaveLength(0);
  });

  it('treats an unknown file list as unknown, not as no overlap', () => {
    const candidates = findDuplicates(subject, [openPullRequest({ files: null })], cfg);
    expect(candidates).toHaveLength(0);
  });

  it('ranks a shared issue above file overlap alone', () => {
    const candidates = findDuplicates(
      { ...subject, linkedIssues: [7] },
      [
        openPullRequest({ number: 2, files: [...subject.files] }),
        openPullRequest({ number: 3, files: ['unrelated.ts'], linkedIssues: [7] }),
      ],
      cfg,
    );
    expect(candidates[0]?.pullRequest.number).toBe(3);
  });

  it('never compares a pull request with itself', () => {
    const candidates = findDuplicates(
      subject,
      [openPullRequest({ number: 10, files: [...subject.files] })],
      cfg,
    );
    expect(candidates).toHaveLength(0);
  });
});

describe('issue references', () => {
  it('finds references in several notations', () => {
    expect(extractIssueReferences('Fix #12', 'Also GH-13 and https://github.com/a/b/issues/14')).toEqual([
      12, 13, 14,
    ]);
  });

  it('ignores references inside code', () => {
    expect(extractIssueReferences('`#12`', '```\n#13\n```')).toEqual([]);
    expect(stripCode('a `b` c')).not.toContain('b');
  });

  it('ignores pull request links and colour codes', () => {
    expect(extractIssueReferences('see https://github.com/a/b/pull/99')).toEqual([]);
    expect(extractIssueReferences('colour #ff00aa')).toEqual([]);
  });

  it('deduplicates and sorts', () => {
    expect(extractIssueReferences('#5 #3 #5')).toEqual([3, 5]);
  });
});
