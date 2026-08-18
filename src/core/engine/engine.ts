import type { AnalysisContext } from '../model/context.js';
import type { Report } from '../model/report.js';
import { errored, type Rule, type RuleResult } from '../model/rule.js';
import { RULES } from '../rules/registry.js';
import { computeScore } from '../scoring/score.js';
import { severityRank } from '../model/severity.js';

export const GENERATOR = 'prproof';

/**
 * Runs every rule, isolating failures.
 *
 * A rule that throws must not take the report with it: the other nine results
 * are still worth publishing, and the broken rule is reported as `errored` so
 * the gap is visible instead of silent.
 */
export function runRules(context: AnalysisContext, rules: readonly Rule[] = RULES): RuleResult[] {
  return rules.map((rule) => {
    try {
      return rule.evaluate(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errored(rule, `Rule failed to run: ${message}`);
    }
  });
}

/** Decides whether the workflow step should exit non-zero. */
export function evaluateFailure(
  results: readonly RuleResult[],
  failOn: readonly string[],
): { failed: boolean; reason: string | null } {
  if (failOn.length === 0) return { failed: false, reason: null };

  const threshold = failOn
    .map((severity) => severityRank(severity as never))
    .reduce((min, rank) => Math.min(min, rank), Number.POSITIVE_INFINITY);

  const triggers = results.filter(
    (result) => result.status === 'failed' && severityRank(result.severity) >= threshold,
  );
  if (triggers.length === 0) return { failed: false, reason: null };

  const names = triggers.map((result) => `${result.id} (${result.severity})`).join(', ');
  return { failed: true, reason: `Failing checks: ${names}` };
}

export function analyse(context: AnalysisContext, rules: readonly Rule[] = RULES): Report {
  const results = runRules(context, rules);
  const score = computeScore(results, context.config);
  const { failed, reason } = evaluateFailure(results, context.config.failOn);

  return {
    version: 1,
    generator: GENERATOR,
    pullRequest: context.pullRequest,
    results,
    checks: context.checks,
    score,
    failed,
    failReason: reason,
    notes: context.notes,
    stats: {
      changedFiles: context.diff.changedFiles,
      additions: context.diff.additions,
      deletions: context.diff.deletions,
      truncated: context.diff.truncated,
    },
  };
}
