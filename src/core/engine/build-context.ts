import { analyseDependencies, type ManifestSnapshots } from '../analysis/dependencies.js';
import { classifyDiff } from '../analysis/classify.js';
import type { Config } from '../config/schema.js';
import type {
  AnalysisContext,
  CheckOutcome,
  DiffSummary,
  OpenPullRequest,
  PullRequestInfo,
} from '../model/context.js';

export interface ContextInput {
  readonly config: Config;
  readonly pullRequest: PullRequestInfo;
  readonly diff: DiffSummary;
  readonly checks: readonly CheckOutcome[];
  readonly openPullRequests?: readonly OpenPullRequest[];
  readonly openPullRequestsAvailable?: boolean;
  readonly local?: boolean;
  readonly notes?: readonly string[];
  /** Full manifest contents, when they could be fetched. See DEP001. */
  readonly manifestSnapshots?: ManifestSnapshots;
}

/**
 * Assembles the analysis context.
 *
 * Classification and dependency analysis happen once, here, rather than inside
 * the rules that need them: rules stay pure and cheap, and two rules asking the
 * same question always get the same answer.
 */
export function buildContext(input: ContextInput): AnalysisContext {
  const classification = classifyDiff(input.diff.files, input.config);
  const dependencies = analyseDependencies(input.diff.files, input.config, input.manifestSnapshots);

  return {
    config: input.config,
    pullRequest: input.pullRequest,
    diff: input.diff,
    classification,
    dependencies,
    checks: input.checks,
    openPullRequests: input.openPullRequests ?? [],
    openPullRequestsAvailable: input.openPullRequestsAvailable ?? false,
    local: input.local ?? false,
    notes: input.notes ?? [],
  };
}
