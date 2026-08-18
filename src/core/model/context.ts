import type { Config, CheckKind } from '../config/schema.js';

export type FileChangeStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed';

export interface ChangedFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: FileChangeStatus;
  readonly additions: number;
  readonly deletions: number;
  /** Unified diff hunk, when the provider could supply one. */
  readonly patch?: string;
}

export interface DiffSummary {
  readonly files: readonly ChangedFile[];
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
  /**
   * True when the provider could not return every file (GitHub caps the pull
   * request files endpoint at 3000). Rules that depend on completeness must
   * degrade to `skipped` rather than draw a conclusion from partial data.
   */
  readonly truncated: boolean;
}

export interface PullRequestInfo {
  readonly number: number | null;
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly labels: readonly string[];
  readonly draft: boolean;
  readonly baseRef: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly url: string | null;
  /** Issue numbers referenced from the title or body (`#123`, `fixes #123`). */
  readonly linkedIssues: readonly number[];
}

export interface OpenPullRequest {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly url: string;
  readonly headRef: string;
  readonly baseRef: string;
  readonly linkedIssues: readonly number[];
  /**
   * Changed file paths, when they were fetched. `null` means "not compared" —
   * the duplicate rule treats that as unknown, never as "no overlap".
   */
  readonly files: readonly string[] | null;
}

export type CheckStatus = 'passed' | 'failed' | 'skipped' | 'unknown';

/** Where a build/test/lint verdict came from. Always shown in the report. */
export type CheckSource =
  | 'run' // PRProof executed the command itself (`mode: run`)
  | 'input' // supplied through action inputs, e.g. `steps.build.outcome`
  | 'check-run' // read from the GitHub Checks API for the head SHA
  | 'not-configured';

export interface CheckOutcome {
  readonly kind: CheckKind;
  readonly status: CheckStatus;
  readonly source: CheckSource;
  readonly required: boolean;
  /** Human-readable one-liner: command, check name, or why it is unknown. */
  readonly detail: string;
  readonly durationMs?: number;
  /** Last few lines of output, already redacted and truncated. Never raw logs. */
  readonly outputTail?: readonly string[];
}

export interface DiffClassification {
  readonly sourceFiles: readonly string[];
  readonly testFiles: readonly string[];
  readonly documentationFiles: readonly string[];
  readonly dependencyFiles: readonly string[];
  readonly lockFiles: readonly string[];
  readonly otherFiles: readonly string[];
  /** True when the pull request touches nothing but documentation. */
  readonly documentationOnly: boolean;
}

export interface DependencyChange {
  readonly manifest: string;
  readonly ecosystem: string;
  readonly name: string;
  readonly version: string | null;
  readonly kind: 'runtime' | 'development' | 'unknown';
}

export interface DependencyReport {
  readonly manifestsChanged: readonly string[];
  readonly lockFilesChanged: readonly string[];
  readonly added: readonly DependencyChange[];
  /** Dependencies present before and after, with a changed version. */
  readonly updated: readonly DependencyChange[];
  /**
   * True when a manifest changed but its diff could not be parsed with
   * confidence. The report then says "unknown", not "no new dependencies".
   */
  readonly incomplete: boolean;
}

/** Everything a rule is allowed to see. Rules perform no I/O of their own. */
export interface AnalysisContext {
  readonly config: Config;
  readonly pullRequest: PullRequestInfo;
  readonly diff: DiffSummary;
  readonly classification: DiffClassification;
  readonly dependencies: DependencyReport;
  readonly checks: readonly CheckOutcome[];
  readonly openPullRequests: readonly OpenPullRequest[];
  /** True when duplicate detection had no data source (e.g. local CLI runs). */
  readonly openPullRequestsAvailable: boolean;
  /** True when the run has no real pull request behind it (local CLI). */
  readonly local: boolean;
  /** Non-fatal notes collected while assembling the context. */
  readonly notes: readonly string[];
}

export function findCheck(context: AnalysisContext, kind: CheckKind): CheckOutcome | undefined {
  return context.checks.find((check) => check.kind === kind);
}
