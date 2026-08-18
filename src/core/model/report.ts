import type { RuleResult } from './rule.js';
import type { CheckOutcome, PullRequestInfo } from './context.js';

export type Band = 'EXCELLENT' | 'GOOD' | 'REVIEW REQUIRED' | 'HIGH RISK';

export interface PenaltyLine {
  readonly ruleId: string;
  readonly title: string;
  readonly severity: string;
  /** Positive number of points removed. */
  readonly points: number;
}

export interface ScoreBreakdown {
  readonly base: number;
  readonly penalties: readonly PenaltyLine[];
  /** Points removed by soft (info/warning) rules after the warning budget. */
  readonly softPenalty: number;
  /** Points discarded because the warning budget was exhausted. */
  readonly softPenaltyClipped: number;
  /** Points removed by high/critical rules. */
  readonly hardPenalty: number;
  /** Score before severity caps were applied. */
  readonly rawScore: number;
  /** Cap imposed by the highest severity present, or `null` when none applies. */
  readonly cap: number | null;
  readonly capReason: string | null;
  readonly score: number;
  readonly band: Band;
}

export interface Report {
  readonly version: 1;
  readonly generator: string;
  readonly pullRequest: PullRequestInfo;
  readonly results: readonly RuleResult[];
  readonly checks: readonly CheckOutcome[];
  readonly score: ScoreBreakdown;
  readonly failed: boolean;
  readonly failReason: string | null;
  readonly notes: readonly string[];
  readonly stats: {
    readonly changedFiles: number;
    readonly additions: number;
    readonly deletions: number;
    readonly truncated: boolean;
  };
}
