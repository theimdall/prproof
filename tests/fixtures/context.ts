import { DEFAULT_CONFIG, type CheckKind, type Config } from '../../src/core/config/schema.js';
import { buildContext } from '../../src/core/engine/build-context.js';
import type {
  AnalysisContext,
  ChangedFile,
  CheckOutcome,
  OpenPullRequest,
  PullRequestInfo,
} from '../../src/core/model/context.js';

/** Deep-merges plain objects; arrays and scalars are replaced wholesale. */
function merge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (
    typeof base !== 'object' ||
    base === null ||
    Array.isArray(base) ||
    typeof override !== 'object' ||
    override === null ||
    Array.isArray(override)
  ) {
    return override as T;
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    result[key] = merge((base as Record<string, unknown>)[key], value);
  }
  return result as T;
}

export function config(override: unknown = {}): Config {
  return merge(DEFAULT_CONFIG, override);
}

export function file(path: string, override: Partial<ChangedFile> = {}): ChangedFile {
  return { path, status: 'modified', additions: 10, deletions: 2, ...override };
}

export function pullRequest(override: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 42,
    title: 'Fix session cleanup',
    body: 'This change fixes the session cleanup path so that expired sessions are removed on logout.',
    author: 'contributor',
    labels: [],
    draft: false,
    baseRef: 'main',
    headRef: 'fix/session-cleanup',
    headSha: 'a'.repeat(40),
    url: 'https://github.com/acme/widgets/pull/42',
    linkedIssues: [],
    ...override,
  };
}

export function check(kind: CheckKind, override: Partial<CheckOutcome> = {}): CheckOutcome {
  return {
    kind,
    status: 'passed',
    source: 'input',
    required: true,
    detail: `${kind} reported as success`,
    ...override,
  };
}

export function openPullRequest(override: Partial<OpenPullRequest> = {}): OpenPullRequest {
  const number = override.number ?? 192;
  return {
    number,
    title: 'Clean up sessions',
    author: 'other',
    url: `https://github.com/acme/widgets/pull/${number}`,
    headRef: 'other/session',
    baseRef: 'main',
    linkedIssues: [],
    files: [],
    ...override,
  };
}

export interface ContextOverrides {
  readonly config?: unknown;
  readonly files?: readonly ChangedFile[];
  readonly pullRequest?: Partial<PullRequestInfo>;
  readonly checks?: readonly CheckOutcome[];
  readonly openPullRequests?: readonly OpenPullRequest[];
  readonly openPullRequestsAvailable?: boolean;
  readonly truncated?: boolean;
  readonly local?: boolean;
  readonly notes?: readonly string[];
}

/** Builds an analysis context for rule tests. Everything has a sane default. */
export function context(overrides: ContextOverrides = {}): AnalysisContext {
  const files = overrides.files ?? [file('src/session.ts'), file('src/session.test.ts')];
  return buildContext({
    config: config(overrides.config),
    pullRequest: pullRequest(overrides.pullRequest),
    diff: {
      files,
      changedFiles: files.length,
      additions: files.reduce((sum, entry) => sum + entry.additions, 0),
      deletions: files.reduce((sum, entry) => sum + entry.deletions, 0),
      truncated: overrides.truncated ?? false,
    },
    checks: overrides.checks ?? [check('build'), check('test'), check('lint')],
    ...(overrides.openPullRequests === undefined ? {} : { openPullRequests: overrides.openPullRequests }),
    ...(overrides.openPullRequestsAvailable === undefined
      ? {}
      : { openPullRequestsAvailable: overrides.openPullRequestsAvailable }),
    ...(overrides.local === undefined ? {} : { local: overrides.local }),
    ...(overrides.notes === undefined ? {} : { notes: overrides.notes }),
  });
}
