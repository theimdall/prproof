import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/core/config/schema.js';
import type { RuleResult } from '../../src/core/model/rule.js';
import type { Severity } from '../../src/core/model/severity.js';
import { bandFor, computeScore, CRITICAL_CAP, HIGH_CAP } from '../../src/core/scoring/score.js';

function failure(id: string, severity: Severity, penaltyFactor?: number): RuleResult {
  return {
    id,
    name: id,
    status: 'failed',
    severity,
    title: `${id} failed`,
    summary: '',
    ...(penaltyFactor === undefined ? {} : { penaltyFactor }),
  };
}

function pass(id: string): RuleResult {
  return { id, name: id, status: 'passed', severity: 'info', title: id, summary: '' };
}

describe('scoring', () => {
  it('gives a clean pull request full marks', () => {
    const score = computeScore([pass('PR001'), pass('TEST002')], DEFAULT_CONFIG);
    expect(score.score).toBe(100);
    expect(score.band).toBe('EXCELLENT');
  });

  it('subtracts the configured weight', () => {
    const score = computeScore([failure('TEST002', 'warning')], DEFAULT_CONFIG);
    expect(score.score).toBe(100 - DEFAULT_CONFIG.scoring.weights['TEST002']!);
    expect(score.penalties).toEqual([
      {
        ruleId: 'TEST002',
        title: 'TEST002 failed',
        severity: 'warning',
        points: DEFAULT_CONFIG.scoring.weights['TEST002'],
      },
    ]);
  });

  it('applies the penalty factor', () => {
    const full = computeScore([failure('PR001', 'warning')], DEFAULT_CONFIG);
    const half = computeScore([failure('PR001', 'warning', 0.5)], DEFAULT_CONFIG);
    expect(100 - half.score).toBe(Math.round((100 - full.score) / 2));
  });

  it('caps a failing build in the HIGH RISK band whatever else is true', () => {
    const score = computeScore([failure('BUILD001', 'critical')], DEFAULT_CONFIG);
    expect(score.rawScore).toBe(60);
    expect(score.cap).toBe(CRITICAL_CAP);
    expect(score.score).toBe(CRITICAL_CAP);
    expect(score.band).toBe('HIGH RISK');
  });

  it('caps a high severity failure below GOOD', () => {
    const score = computeScore([failure('LINT001', 'high')], DEFAULT_CONFIG);
    expect(score.cap).toBe(HIGH_CAP);
    expect(score.score).toBe(HIGH_CAP);
    expect(score.band).toBe('REVIEW REQUIRED');
  });

  it('never lets warnings alone spend more than the warning budget', () => {
    const warnings: RuleResult[] = [
      failure('TEST002', 'warning'),
      failure('PR001', 'warning'),
      failure('PR002', 'warning'),
      failure('DUP001', 'warning'),
      failure('DEP001', 'warning'),
    ];
    const score = computeScore(warnings, DEFAULT_CONFIG);
    expect(score.softPenalty).toBe(DEFAULT_CONFIG.scoring.warningBudget);
    expect(score.softPenaltyClipped).toBeGreaterThan(0);
    expect(score.score).toBe(100 - DEFAULT_CONFIG.scoring.warningBudget);
  });

  it('stays inside 0..100 for any combination of failures', () => {
    const severities: Severity[] = ['info', 'warning', 'high', 'critical'];
    const ids = Object.keys(DEFAULT_CONFIG.scoring.weights);
    for (let mask = 0; mask < 1 << ids.length; mask += 7) {
      const results = ids
        .filter((_, index) => (mask & (1 << index)) !== 0)
        .map((id, index) => failure(id, severities[index % severities.length] as Severity));
      const score = computeScore(results, DEFAULT_CONFIG);
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(100);
      expect(score.band).toBe(bandFor(score.score));
    }
  });

  it('ignores skipped and errored results', () => {
    const results: RuleResult[] = [
      { id: 'BUILD001', name: 'Build', status: 'skipped', severity: 'info', title: '', summary: '' },
      { id: 'TEST001', name: 'Tests', status: 'errored', severity: 'info', title: '', summary: '' },
    ];
    expect(computeScore(results, DEFAULT_CONFIG).score).toBe(100);
  });

  it('maps scores onto the documented bands', () => {
    expect(bandFor(100)).toBe('EXCELLENT');
    expect(bandFor(90)).toBe('EXCELLENT');
    expect(bandFor(89)).toBe('GOOD');
    expect(bandFor(75)).toBe('GOOD');
    expect(bandFor(74)).toBe('REVIEW REQUIRED');
    expect(bandFor(50)).toBe('REVIEW REQUIRED');
    expect(bandFor(49)).toBe('HIGH RISK');
    expect(bandFor(0)).toBe('HIGH RISK');
  });
});
