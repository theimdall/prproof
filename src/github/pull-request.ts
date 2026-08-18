import { extractIssueReferences } from '../core/analysis/issues.js';
import type {
  ChangedFile,
  DiffSummary,
  FileChangeStatus,
  OpenPullRequest,
  PullRequestInfo,
} from '../core/model/context.js';
import type { DuplicateDetectionConfig } from '../core/config/schema.js';
import type { ApiFile, ApiPullRequest, GitHubApi } from './api.js';

/** GitHub's pull request files endpoint stops at 3000 entries. */
export const MAX_PULL_REQUEST_FILES = 3000;

/** One page of files is enough to compare pull requests for overlap. */
const COMPARISON_FILE_LIMIT = 100;

function toStatus(status: string): FileChangeStatus {
  switch (status) {
    case 'added':
    case 'removed':
    case 'modified':
    case 'renamed':
    case 'copied':
      return status;
    default:
      return 'changed';
  }
}

export function toChangedFile(file: ApiFile): ChangedFile {
  return {
    path: file.filename,
    status: toStatus(file.status),
    additions: file.additions,
    deletions: file.deletions,
    ...(file.previous_filename === undefined ? {} : { previousPath: file.previous_filename }),
    ...(file.patch === undefined ? {} : { patch: file.patch }),
  };
}

export function toDiffSummary(files: readonly ApiFile[], truncated: boolean): DiffSummary {
  const changed = files.map(toChangedFile);
  return {
    files: changed,
    changedFiles: changed.length,
    additions: changed.reduce((sum, file) => sum + file.additions, 0),
    deletions: changed.reduce((sum, file) => sum + file.deletions, 0),
    truncated,
  };
}

export function toPullRequestInfo(pull: ApiPullRequest): PullRequestInfo {
  const body = pull.body ?? '';
  return {
    number: pull.number,
    title: pull.title,
    body,
    author: pull.user?.login ?? 'unknown',
    labels: (pull.labels ?? []).map((label) => label.name),
    draft: pull.draft ?? false,
    baseRef: pull.base.ref,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
    url: pull.html_url,
    linkedIssues: extractIssueReferences(pull.title, body),
  };
}

export interface OpenPullRequestsResult {
  readonly pullRequests: readonly OpenPullRequest[];
  readonly available: boolean;
  readonly notes: readonly string[];
}

/**
 * Collects the open pull requests duplicate detection compares against.
 *
 * File lists are fetched for only a bounded subset — pull requests sharing a
 * linked issue first, then the most recently updated — because every extra
 * comparison is an API call against the same rate limit the rest of the
 * workflow is using. When a file list comes back at the page limit it is
 * recorded as unknown rather than partial: a truncated set would understate
 * overlap and produce confidently wrong similarity numbers.
 */
export async function collectOpenPullRequests(
  api: GitHubApi,
  config: DuplicateDetectionConfig,
  current: { number: number | null; linkedIssues: readonly number[] },
): Promise<OpenPullRequestsResult> {
  const notes: string[] = [];
  let listed: ApiPullRequest[];
  try {
    listed = await api.listOpenPullRequests(config.maxOpenPullRequests);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { pullRequests: [], available: false, notes: [`Could not list open pull requests: ${message}`] };
  }

  const others = listed.filter((pull) => pull.number !== current.number);
  const currentIssues = new Set(current.linkedIssues);

  const withIssues = others.map((pull) => ({
    pull,
    issues: extractIssueReferences(pull.title, pull.body ?? ''),
  }));

  const prioritised = [...withIssues].sort((a, b) => {
    const aShares = a.issues.some((issue) => currentIssues.has(issue)) ? 1 : 0;
    const bShares = b.issues.some((issue) => currentIssues.has(issue)) ? 1 : 0;
    return bShares - aShares;
  });

  const compared = prioritised.slice(0, config.maxComparedPullRequests);
  if (prioritised.length > compared.length) {
    notes.push(
      `Duplicate detection compared ${compared.length} of ${prioritised.length} open pull requests ` +
        '(duplicate_detection.max_compared_pull_requests).',
    );
  }

  const results: OpenPullRequest[] = [];
  for (const entry of prioritised) {
    const isCompared = compared.includes(entry);
    let files: string[] | null = null;

    if (isCompared) {
      try {
        const response = await api.listPullRequestFiles(entry.pull.number, COMPARISON_FILE_LIMIT);
        files = response.truncated ? null : response.files.map((file) => file.filename);
      } catch {
        files = null;
      }
    }

    results.push({
      number: entry.pull.number,
      title: entry.pull.title,
      author: entry.pull.user?.login ?? 'unknown',
      url: entry.pull.html_url,
      headRef: entry.pull.head.ref,
      baseRef: entry.pull.base.ref,
      linkedIssues: entry.issues,
      files,
    });
  }

  return { pullRequests: results, available: true, notes };
}
