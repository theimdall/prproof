import { describe, expect, it } from 'vitest';

import { analyse } from '../../src/core/engine/engine.js';
import { COMMENT_MARKER, renderMarkdown } from '../../src/core/render/markdown.js';
import { conclusionFor, publishCheckRun } from '../../src/github/check-run.js';
import { upsertReportComment } from '../../src/github/comment.js';
import type { ApiComment, GitHubApi } from '../../src/github/api.js';
import { parseArgs, UsageError } from '../../src/cli/index.js';
import { scenario } from '../fixtures/scenarios.js';

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

function fakeApi(
  comments: ApiComment[],
  overrides: Partial<GitHubApi> = {},
): GitHubApi & {
  created: string[];
  updated: { id: number; body: string }[];
} {
  const created: string[] = [];
  const updated: { id: number; body: string }[] = [];

  const api = {
    listPullRequestFiles: async () => ({ files: [], truncated: false }),
    listOpenPullRequests: async () => [],
    listCheckRuns: async () => [],
    listIssueComments: async () => comments,
    createIssueComment: async (_n: number, body: string) => {
      created.push(body);
    },
    updateIssueComment: async (id: number, body: string) => {
      updated.push({ id, body });
    },
    createCheckRun: async () => undefined,
    getFileContent: async () => null,
    ...overrides,
  };

  return Object.assign(api, { created, updated });
}

function botComment(id: number, body: string): ApiComment {
  return { id, body, user: { login: 'github-actions[bot]', type: 'Bot' } };
}

describe('sticky comment', () => {
  const body = `${COMMENT_MARKER}\n## PRProof Report\n`;

  it('creates the comment when none exists', async () => {
    const api = fakeApi([]);
    const result = await upsertReportComment(api, 1, body);
    expect(result.action).toBe('created');
    expect(api.created).toHaveLength(1);
  });

  it('updates its own previous comment instead of adding another', async () => {
    const api = fakeApi([botComment(7, `${COMMENT_MARKER}\nold`)]);
    const result = await upsertReportComment(api, 1, body);
    expect(result.action).toBe('updated');
    expect(api.updated[0]?.id).toBe(7);
    expect(api.created).toHaveLength(0);
  });

  it('does nothing when the report has not changed', async () => {
    const api = fakeApi([botComment(7, body)]);
    const result = await upsertReportComment(api, 1, body);
    expect(result.action).toBe('unchanged');
    expect(api.updated).toHaveLength(0);
    expect(api.created).toHaveLength(0);
  });

  it('never overwrites a human comment that contains the marker', async () => {
    const human: ApiComment = {
      id: 9,
      body: `${COMMENT_MARKER} I pasted this myself`,
      user: { login: 'someone', type: 'User' },
    };
    const api = fakeApi([human]);
    const result = await upsertReportComment(api, 1, body);
    expect(result.action).toBe('created');
    expect(api.updated).toHaveLength(0);
  });

  it('degrades gracefully when the token cannot write', async () => {
    const api = fakeApi([], {
      listIssueComments: async () => {
        throw new HttpError(403);
      },
    });
    const result = await upsertReportComment(api, 1, body);
    expect(result.action).toBe('forbidden');
    expect(result.message).toContain('fork');
  });

  it('rethrows unexpected API errors', async () => {
    const api = fakeApi([], {
      listIssueComments: async () => {
        throw new HttpError(500);
      },
    });
    await expect(upsertReportComment(api, 1, body)).rejects.toThrow('HTTP 500');
  });
});

describe('check run', () => {
  it('fails the check only when the report blocks', () => {
    expect(conclusionFor(analyse(scenario('failed-build').build()))).toBe('failure');
  });

  it('uses neutral for a low score that is not blocking', () => {
    const report = { ...analyse(scenario('no-test-changes').build()), failed: false };
    expect(conclusionFor({ ...report, score: { ...report.score, band: 'REVIEW REQUIRED' } })).toBe('neutral');
  });

  it('succeeds for a good report', () => {
    expect(conclusionFor(analyse(scenario('small-good-pr').build()))).toBe('success');
  });

  it('degrades gracefully without checks: write', async () => {
    const api = fakeApi([], {
      createCheckRun: async () => {
        throw new HttpError(403);
      },
    });
    const result = await publishCheckRun(api, analyse(scenario('small-good-pr').build()));
    expect(result.action).toBe('forbidden');
  });
});

describe('rendered comment', () => {
  it('carries the marker exactly once', () => {
    const markdown = renderMarkdown(analyse(scenario('large-pr').build()));
    expect(markdown.split(COMMENT_MARKER)).toHaveLength(2);
  });
});

describe('cli argument parsing', () => {
  it('defaults to analyze', () => {
    expect(parseArgs([]).command).toBe('analyze');
  });

  it('reads options', () => {
    const options = parseArgs(['analyze', '--base', 'develop', '--format', 'json', '--run', '--no-color']);
    expect(options.base).toBe('develop');
    expect(options.format).toBe('json');
    expect(options.run).toBe(true);
    expect(options.color).toBe(false);
  });

  it('rejects unknown commands, options and formats', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow(UsageError);
    expect(() => parseArgs(['--nope'])).toThrow(UsageError);
    expect(() => parseArgs(['--format', 'xml'])).toThrow(UsageError);
    expect(() => parseArgs(['--base'])).toThrow(UsageError);
  });
});
