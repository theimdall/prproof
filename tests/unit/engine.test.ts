import { describe, expect, it } from 'vitest';

import { analyse, evaluateFailure, runRules } from '../../src/core/engine/engine.js';
import type { Rule } from '../../src/core/model/rule.js';
import { RULES } from '../../src/core/rules/registry.js';
import { check, context } from '../fixtures/context.js';

const explodingRule: Rule = {
  id: 'BOOM001',
  name: 'Exploding rule',
  severity: 'warning',
  description: 'Always throws.',
  evaluate() {
    throw new Error('kaboom');
  },
};

describe('engine', () => {
  it('runs every registered rule', () => {
    const results = runRules(context());
    expect(results).toHaveLength(RULES.length);
    expect(new Set(results.map((result) => result.id)).size).toBe(RULES.length);
  });

  it('isolates a rule that throws', () => {
    const results = runRules(context(), [explodingRule, ...RULES]);
    const boom = results.find((result) => result.id === 'BOOM001');
    expect(boom?.status).toBe('errored');
    expect(boom?.summary).toContain('kaboom');
    expect(results).toHaveLength(RULES.length + 1);
  });

  it('does not score a rule that errored', () => {
    const report = analyse(context(), [explodingRule]);
    expect(report.score.score).toBe(100);
  });

  it('fails the job only for severities listed in fail_on', () => {
    expect(
      evaluateFailure(
        [{ id: 'TEST002', name: '', status: 'failed', severity: 'warning', title: '', summary: '' }],
        ['critical'],
      ).failed,
    ).toBe(false);

    const critical = evaluateFailure(
      [{ id: 'TEST001', name: '', status: 'failed', severity: 'critical', title: '', summary: '' }],
      ['critical'],
    );
    expect(critical.failed).toBe(true);
    expect(critical.reason).toContain('TEST001');
  });

  it('never fails when fail_on is empty', () => {
    const report = analyse(
      context({
        config: { failOn: [] },
        checks: [check('build', { status: 'failed' })],
      }),
    );
    expect(report.failed).toBe(false);
    expect(report.score.band).toBe('HIGH RISK');
  });

  it('treats fail_on: [high] as "high and above"', () => {
    const report = analyse(
      context({
        config: { failOn: ['high'], checks: { lint: { required: true } } },
        checks: [check('lint', { status: 'failed' })],
      }),
    );
    expect(report.failed).toBe(true);
  });

  it('carries the diff statistics into the report', () => {
    const report = analyse(context());
    expect(report.stats.changedFiles).toBe(2);
    expect(report.stats.truncated).toBe(false);
    expect(report.generator).toBe('prproof');
  });
});
