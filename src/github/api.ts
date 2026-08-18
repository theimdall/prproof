import type { getOctokit } from '@actions/github';

import type { CheckRunSummary } from '../adapters/checks/resolve.js';

export type Octokit = ReturnType<typeof getOctokit>;

export interface ApiFile {
  readonly filename: string;
  readonly previous_filename?: string | undefined;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch?: string | undefined;
}

export interface ApiPullRequest {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly user: { readonly login: string } | null;
  readonly html_url: string;
  readonly draft?: boolean | undefined;
  readonly head: { readonly ref: string; readonly sha: string };
  readonly base: { readonly ref: string; readonly sha?: string | undefined };
  readonly labels?: readonly { readonly name: string }[] | undefined;
}

export interface ApiComment {
  readonly id: number;
  readonly body: string | undefined;
  readonly user: { readonly login: string; readonly type?: string | undefined } | null;
}

export interface CreateCheckRunParams {
  readonly name: string;
  readonly headSha: string;
  readonly conclusion: 'success' | 'failure' | 'neutral';
  readonly title: string;
  readonly summary: string;
}

/**
 * The GitHub surface PRProof depends on, expressed as an interface.
 *
 * Everything above this line is Octokit's problem; everything below is
 * testable with a plain object. It also documents, in one screen, exactly which
 * API scopes the action needs — which is what the permissions block in the
 * README has to match.
 */
export interface GitHubApi {
  listPullRequestFiles(pullNumber: number, limit: number): Promise<{ files: ApiFile[]; truncated: boolean }>;
  listOpenPullRequests(limit: number): Promise<ApiPullRequest[]>;
  listCheckRuns(headSha: string): Promise<CheckRunSummary[]>;
  listIssueComments(pullNumber: number): Promise<ApiComment[]>;
  createIssueComment(pullNumber: number, body: string): Promise<void>;
  updateIssueComment(commentId: number, body: string): Promise<void>;
  createCheckRun(params: CreateCheckRunParams): Promise<void>;
  getFileContent(path: string, ref: string): Promise<string | null>;
}

const PAGE_SIZE = 100;

export function createGitHubApi(octokit: Octokit, owner: string, repo: string): GitHubApi {
  return {
    async listPullRequestFiles(pullNumber, limit) {
      const files: ApiFile[] = [];
      let truncated = false;

      for (let page = 1; page <= Math.ceil(limit / PAGE_SIZE); page += 1) {
        const response = await octokit.rest.pulls.listFiles({
          owner,
          repo,
          pull_number: pullNumber,
          per_page: PAGE_SIZE,
          page,
        });
        files.push(...(response.data as ApiFile[]));
        if (response.data.length < PAGE_SIZE) return { files, truncated };
        if (files.length >= limit) {
          truncated = true;
          break;
        }
      }
      return { files: files.slice(0, limit), truncated: true };
    },

    async listOpenPullRequests(limit) {
      const response = await octokit.rest.pulls.list({
        owner,
        repo,
        state: 'open',
        sort: 'updated',
        direction: 'desc',
        per_page: Math.min(limit, PAGE_SIZE),
      });
      return response.data;
    },

    async listCheckRuns(headSha) {
      const response = await octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: headSha,
        per_page: PAGE_SIZE,
      });
      return response.data.check_runs.map((run) => ({
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
      }));
    },

    async listIssueComments(pullNumber) {
      const comments: ApiComment[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const response = await octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: pullNumber,
          per_page: PAGE_SIZE,
          page,
        });
        comments.push(...(response.data as unknown as ApiComment[]));
        if (response.data.length < PAGE_SIZE) break;
      }
      return comments;
    },

    async createIssueComment(pullNumber, body) {
      await octokit.rest.issues.createComment({ owner, repo, issue_number: pullNumber, body });
    },

    async updateIssueComment(commentId, body) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body });
    },

    async createCheckRun(params) {
      await octokit.rest.checks.create({
        owner,
        repo,
        name: params.name,
        head_sha: params.headSha,
        status: 'completed',
        conclusion: params.conclusion,
        output: { title: params.title, summary: params.summary },
      });
    },

    async getFileContent(path, ref) {
      try {
        const response = await octokit.rest.repos.getContent({ owner, repo, path, ref });
        const data = response.data as { content?: string; encoding?: string; type?: string };
        if (data.type !== 'file' || typeof data.content !== 'string') return null;
        return Buffer.from(data.content, (data.encoding as BufferEncoding) ?? 'base64').toString('utf8');
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
  };
}

export function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: number }).status === 404
  );
}

export function isForbidden(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  const status = (error as { status: number }).status;
  return status === 403 || status === 401;
}
