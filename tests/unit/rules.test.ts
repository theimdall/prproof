import { describe, expect, it } from 'vitest';

import { buildRule, lintRule, testRule } from '../../src/core/rules/checks.js';
import { dependencyChangeRule } from '../../src/core/rules/dependency-change.js';
import { documentationOnlyRule } from '../../src/core/rules/documentation-only.js';
import { duplicatePullRequestRule } from '../../src/core/rules/duplicate-pr.js';
import { prDescriptionRule, meaningfulLength } from '../../src/core/rules/pr-description.js';
import { prIssueReferenceRule } from '../../src/core/rules/pr-issue-reference.js';
import { prSizeRule, sizeFactor } from '../../src/core/rules/pr-size.js';
import { testChangesRule } from '../../src/core/rules/test-changes.js';
import { check, context, file, openPullRequest } from '../fixtures/context.js';

describe('PR001 pull request size', () => {
  it('passes within the configured limits', () => {
    const result = prSizeRule.evaluate(context());
    expect(result.status).toBe('passed');
  });

  it('fails when too many files changed', () => {
    const files = Array.from({ length: 30 }, (_, index) => file(`src/file-${index}.ts`));
    const result = prSizeRule.evaluate(context({ files }));
    expect(result.status).toBe('failed');
    expect(result.title).toBe('Large pull request');
  });

  it('fails when too many lines changed', () => {
    const files = [file('src/big.ts', { additions: 2000, deletions: 100 })];
    const result = prSizeRule.evaluate(context({ files }));
    expect(result.status).toBe('failed');
  });

  it('scales the penalty with the overshoot', () => {
    expect(sizeFactor(1)).toBe(0);
    // Just past the limit costs the floor, not nothing and not everything.
    expect(sizeFactor(1.01)).toBeCloseTo(0.5, 1);
    expect(sizeFactor(1.5)).toBeCloseTo(0.75, 5);
    expect(sizeFactor(2)).toBe(1);
    expect(sizeFactor(10)).toBe(1);
  });

  it('mentions truncation when the diff was cut short', () => {
    const files = Array.from({ length: 30 }, (_, index) => file(`src/file-${index}.ts`));
    const result = prSizeRule.evaluate(context({ files, truncated: true }));
    expect(result.details?.some((detail) => detail.includes('truncated'))).toBe(true);
  });
});

describe('PR002 description', () => {
  it('passes for a real description', () => {
    expect(prDescriptionRule.evaluate(context()).status).toBe('passed');
  });

  it('fails for an empty description', () => {
    const result = prDescriptionRule.evaluate(context({ pullRequest: { body: '' } }));
    expect(result.status).toBe('failed');
    expect(result.title).toBe('Missing description');
  });

  it('does not count template comments as a description', () => {
    const body = '<!-- Describe your change here. Explain why it is needed and how it works. -->';
    expect(meaningfulLength(body)).toBe(0);
    const result = prDescriptionRule.evaluate(context({ pullRequest: { body } }));
    expect(result.status).toBe('failed');
  });

  it('is skipped in local mode', () => {
    expect(prDescriptionRule.evaluate(context({ local: true })).status).toBe('skipped');
  });
});

describe('PR003 linked issue', () => {
  it('is skipped unless required', () => {
    expect(prIssueReferenceRule.evaluate(context()).status).toBe('skipped');
  });

  it('fails when required and missing', () => {
    const ctx = context({ config: { pullRequest: { requireIssueReference: true } } });
    expect(prIssueReferenceRule.evaluate(ctx).status).toBe('failed');
  });

  it('passes when an issue is referenced', () => {
    const ctx = context({
      config: { pullRequest: { requireIssueReference: true } },
      pullRequest: { linkedIssues: [123] },
    });
    expect(prIssueReferenceRule.evaluate(ctx).status).toBe('passed');
  });
});

describe('BUILD001 / TEST001 / LINT001', () => {
  it('passes when the workflow reported success', () => {
    expect(buildRule.evaluate(context()).status).toBe('passed');
  });

  it('fails as critical when a required check failed', () => {
    const ctx = context({ checks: [check('build', { status: 'failed' })] });
    const result = buildRule.evaluate(ctx);
    expect(result.status).toBe('failed');
    expect(result.severity).toBe('critical');
    expect(result.penaltyFactor).toBe(1);
  });

  it('downgrades a non-required failure and halves its penalty', () => {
    const ctx = context({ checks: [check('build', { status: 'failed', required: false })] });
    const result = buildRule.evaluate(ctx);
    expect(result.severity).toBe('high');
    expect(result.penaltyFactor).toBe(0.5);
  });

  it('reports an unknown outcome as errored rather than failed', () => {
    const ctx = context({
      checks: [check('test', { status: 'unknown', detail: 'no check run found' })],
    });
    expect(testRule.evaluate(ctx).status).toBe('errored');
  });

  it('is skipped when nothing is configured', () => {
    const ctx = context({ checks: [check('lint', { source: 'not-configured', status: 'unknown' })] });
    expect(lintRule.evaluate(ctx).status).toBe('skipped');
  });

  it('is skipped for documentation-only pull requests', () => {
    const ctx = context({
      files: [file('README.md')],
      checks: [check('build', { status: 'failed' })],
    });
    expect(buildRule.evaluate(ctx).status).toBe('skipped');
  });
});

describe('TEST002 test changes', () => {
  it('passes when tests changed alongside source', () => {
    expect(testChangesRule.evaluate(context()).status).toBe('passed');
  });

  it('fails when only source changed', () => {
    const ctx = context({ files: [file('src/session.ts'), file('src/user.ts')] });
    const result = testChangesRule.evaluate(ctx);
    expect(result.status).toBe('failed');
    expect(result.severity).toBe('warning');
  });

  it('is skipped for documentation-only pull requests', () => {
    const ctx = context({ files: [file('docs/guide.md'), file('README.md')] });
    expect(testChangesRule.evaluate(ctx).status).toBe('skipped');
  });

  it('is skipped when no source files changed', () => {
    const ctx = context({ files: [file('.github/workflows/ci.yml')] });
    expect(testChangesRule.evaluate(ctx).status).toBe('skipped');
  });

  it('is skipped when the diff was truncated', () => {
    const ctx = context({ files: [file('src/session.ts')], truncated: true });
    expect(testChangesRule.evaluate(ctx).status).toBe('skipped');
  });
});

describe('DEP001 dependencies', () => {
  it('passes when no manifest changed', () => {
    expect(dependencyChangeRule.evaluate(context()).status).toBe('passed');
  });

  it('reports a newly added dependency', () => {
    const patch = [
      '@@ -1,6 +1,7 @@',
      ' {',
      '   "dependencies": {',
      '     "react": "^18.0.0",',
      '+    "axios": "^1.6.0"',
      '   }',
      ' }',
    ].join('\n');
    const ctx = context({ files: [file('package.json', { patch })] });
    const result = dependencyChangeRule.evaluate(ctx);
    expect(result.status).toBe('failed');
    expect(result.details?.some((detail) => detail.includes('axios'))).toBe(true);
  });

  it('says "unknown" rather than "none" when a manifest cannot be parsed', () => {
    const ctx = context({ files: [file('pom.xml', { patch: '@@ -1 +1 @@\n+<dependency/>' })] });
    const result = dependencyChangeRule.evaluate(ctx);
    expect(result.status).toBe('failed');
    expect(result.severity).toBe('info');
    expect(result.summary).toContain('could not determine');
  });

  it('treats a lock-only change as informational', () => {
    const ctx = context({ files: [file('package-lock.json')] });
    const result = dependencyChangeRule.evaluate(ctx);
    expect(result.severity).toBe('info');
    expect(result.title).toBe('Lock file updated');
  });
});

describe('DUP001 duplicate pull requests', () => {
  const sharedFiles = ['src/session.ts', 'src/user.ts', 'src/auth.ts', 'src/token.ts'];

  it('is skipped when open pull requests are unavailable', () => {
    expect(duplicatePullRequestRule.evaluate(context()).status).toBe('skipped');
  });

  it('passes when nothing overlaps', () => {
    const ctx = context({
      openPullRequestsAvailable: true,
      openPullRequests: [openPullRequest({ files: ['docs/readme.md'] })],
    });
    expect(duplicatePullRequestRule.evaluate(ctx).status).toBe('passed');
  });

  it('flags heavy file overlap', () => {
    const ctx = context({
      files: sharedFiles.map((path) => file(path)),
      openPullRequestsAvailable: true,
      openPullRequests: [openPullRequest({ files: sharedFiles })],
    });
    const result = duplicatePullRequestRule.evaluate(ctx);
    expect(result.status).toBe('failed');
    expect(result.summary).toContain('overlap');
  });

  it('flags a shared linked issue even without file overlap', () => {
    const ctx = context({
      pullRequest: { linkedIssues: [77] },
      openPullRequestsAvailable: true,
      openPullRequests: [openPullRequest({ files: ['other.ts'], linkedIssues: [77] })],
    });
    expect(duplicatePullRequestRule.evaluate(ctx).status).toBe('failed');
  });

  it('ignores stacked branches', () => {
    const ctx = context({
      files: sharedFiles.map((path) => file(path)),
      pullRequest: { headRef: 'feature/base' },
      openPullRequestsAvailable: true,
      openPullRequests: [openPullRequest({ files: sharedFiles, baseRef: 'feature/base' })],
    });
    expect(duplicatePullRequestRule.evaluate(ctx).status).toBe('passed');
  });

  it('ignores lock files when comparing', () => {
    const ctx = context({
      files: [file('package-lock.json'), file('src/a.ts')],
      openPullRequestsAvailable: true,
      openPullRequests: [openPullRequest({ files: ['package-lock.json', 'src/b.ts'] })],
    });
    expect(duplicatePullRequestRule.evaluate(ctx).status).toBe('passed');
  });
});

describe('DOC001 documentation-only', () => {
  it('passes for a documentation-only pull request', () => {
    const ctx = context({ files: [file('docs/a.md'), file('README.md')] });
    const result = documentationOnlyRule.evaluate(ctx);
    expect(result.status).toBe('passed');
    expect(result.details?.[0]).toContain('build');
  });

  it('is skipped otherwise', () => {
    expect(documentationOnlyRule.evaluate(context()).status).toBe('skipped');
  });
});
