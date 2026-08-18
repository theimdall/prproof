import type { Severity } from './severity.js';
import type { AnalysisContext } from './context.js';

/**
 * A rule outcome is one of four states, and only `failed` ever costs points.
 *
 * `skipped` and `errored` are deliberately distinct from `passed`: a check that
 * could not run is not a check that succeeded, and the report says so. Silently
 * reporting green for a rule that never executed is how a quality gate loses
 * the trust it exists to earn.
 */
export type RuleStatus = 'passed' | 'failed' | 'skipped' | 'errored';

export interface RuleResult {
  /** Stable identifier, e.g. `PR001`. Referenced by config and documentation. */
  readonly id: string;
  readonly name: string;
  readonly status: RuleStatus;
  /**
   * Severity of *this* outcome. Usually the rule's declared severity, but a
   * rule may downgrade it (for example a non-required build check).
   */
  readonly severity: Severity;
  /** Short headline, e.g. `Pull request is large`. */
  readonly title: string;
  /** One or two sentences explaining the outcome in plain language. */
  readonly summary: string;
  /** Optional bullet points rendered underneath the summary. */
  readonly details?: readonly string[];
  /**
   * Multiplier applied to the configured penalty weight, in `[0, 1]`.
   * Lets a rule scale its cost with how badly the threshold was missed
   * (see `PR001`) while keeping the weight itself user-configurable.
   */
  readonly penaltyFactor?: number;
  /** Machine-readable extras for the JSON report. Never rendered as markdown. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface Rule {
  readonly id: string;
  readonly name: string;
  /** Severity used when this rule fails, unless the result overrides it. */
  readonly severity: Severity;
  /** One-line description, surfaced by `prproof rules` and the docs. */
  readonly description: string;
  evaluate(context: AnalysisContext): RuleResult;
}

/** Convenience constructors keep rule bodies free of boilerplate. */
export function passed(
  rule: Rule,
  title: string,
  summary: string,
  extra: Partial<RuleResult> = {},
): RuleResult {
  return {
    id: rule.id,
    name: rule.name,
    severity: rule.severity,
    status: 'passed',
    title,
    summary,
    ...extra,
  };
}

export function failed(
  rule: Rule,
  title: string,
  summary: string,
  extra: Partial<RuleResult> = {},
): RuleResult {
  return {
    id: rule.id,
    name: rule.name,
    severity: rule.severity,
    status: 'failed',
    title,
    summary,
    ...extra,
  };
}

export function skipped(rule: Rule, reason: string): RuleResult {
  return {
    id: rule.id,
    name: rule.name,
    severity: 'info',
    status: 'skipped',
    title: rule.name,
    summary: reason,
  };
}

export function errored(rule: Rule, reason: string): RuleResult {
  return {
    id: rule.id,
    name: rule.name,
    severity: 'info',
    status: 'errored',
    title: rule.name,
    summary: reason,
  };
}
