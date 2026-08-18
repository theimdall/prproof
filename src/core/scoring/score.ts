import type { Config } from '../config/schema.js';
import type { RuleResult } from '../model/rule.js';
import type { Band, PenaltyLine, ScoreBreakdown } from '../model/report.js';
import { severityRank } from '../model/severity.js';

export const BASE_SCORE = 100;

/**
 * Severity ceilings.
 *
 * Subtraction alone produces nonsense: a pull request with a broken build but
 * an otherwise spotless diff would land in the seventies and read as "GOOD".
 * A ceiling makes the model say the only honest thing — a failing build is not
 * a good pull request, whatever else is true about it.
 */
export const CRITICAL_CAP = 45;
export const HIGH_CAP = 74;

export const BANDS: readonly { readonly min: number; readonly band: Band }[] = [
  { min: 90, band: 'EXCELLENT' },
  { min: 75, band: 'GOOD' },
  { min: 50, band: 'REVIEW REQUIRED' },
  { min: 0, band: 'HIGH RISK' },
];

export function bandFor(score: number): Band {
  for (const entry of BANDS) {
    if (score >= entry.min) return entry.band;
  }
  return 'HIGH RISK';
}

function pointsFor(result: RuleResult, config: Config): number {
  const weight = config.scoring.weights[result.id] ?? 0;
  const factor = result.penaltyFactor ?? 1;
  const bounded = Math.min(1, Math.max(0, factor));
  return Math.round(weight * bounded);
}

/**
 * Turns rule results into a score, and — just as importantly — into the
 * arithmetic that produced it. Every number in the report can be traced to a
 * rule identifier; nothing is a black box.
 */
export function computeScore(results: readonly RuleResult[], config: Config): ScoreBreakdown {
  const failures = results.filter((result) => result.status === 'failed');

  const penalties: PenaltyLine[] = [];
  let softPenalty = 0;
  let hardPenalty = 0;

  for (const result of failures) {
    const points = pointsFor(result, config);
    if (points > 0) {
      penalties.push({
        ruleId: result.id,
        title: result.title,
        severity: result.severity,
        points,
      });
    }
    if (severityRank(result.severity) >= severityRank('high')) hardPenalty += points;
    else softPenalty += points;
  }

  penalties.sort((a, b) => b.points - a.points || a.ruleId.localeCompare(b.ruleId));

  const budget = config.scoring.warningBudget;
  const softApplied = Math.min(softPenalty, budget);
  const softPenaltyClipped = softPenalty - softApplied;

  const rawScore = BASE_SCORE - softApplied - hardPenalty;

  const hasCritical = failures.some((result) => result.severity === 'critical');
  const hasHigh = failures.some((result) => result.severity === 'high');

  let cap: number | null = null;
  let capReason: string | null = null;
  if (hasCritical) {
    cap = CRITICAL_CAP;
    capReason = 'a critical check failed';
  } else if (hasHigh) {
    cap = HIGH_CAP;
    capReason = 'a high severity check failed';
  }

  const capped = cap === null ? rawScore : Math.min(rawScore, cap);
  const score = Math.max(0, Math.min(BASE_SCORE, capped));

  return {
    base: BASE_SCORE,
    penalties,
    softPenalty: softApplied,
    softPenaltyClipped,
    hardPenalty,
    rawScore,
    cap,
    capReason,
    score,
    band: bandFor(score),
  };
}
