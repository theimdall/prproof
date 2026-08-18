import { describe, expect, it } from 'vitest';

import { analyse } from '../../src/core/engine/engine.js';
import { renderMarkdown } from '../../src/core/render/markdown.js';
import { renderTerminal } from '../../src/core/render/terminal.js';
import { SCENARIOS, scenario } from '../fixtures/scenarios.js';

/**
 * End-to-end expectations per scenario.
 *
 * These are the numbers the README and the demo quote, so they are asserted
 * rather than described: if the scoring model moves, the documentation is
 * wrong and this test says so.
 */
describe('scenarios', () => {
  it('rates a small, well-tested pull request as EXCELLENT', () => {
    const report = analyse(scenario('small-good-pr').build());
    expect(report.score.score).toBe(100);
    expect(report.score.band).toBe('EXCELLENT');
    expect(report.failed).toBe(false);
  });

  it('keeps a failing build in HIGH RISK and blocks', () => {
    const report = analyse(scenario('failed-build').build());
    expect(report.score.band).toBe('HIGH RISK');
    expect(report.failed).toBe(true);
    expect(report.failReason).toContain('BUILD001');
  });

  it('keeps a failing test suite in HIGH RISK and blocks', () => {
    const report = analyse(scenario('failed-tests').build());
    expect(report.score.band).toBe('HIGH RISK');
    expect(report.failed).toBe(true);
  });

  it('warns without blocking on a large pull request', () => {
    const report = analyse(scenario('large-pr').build());
    expect(report.failed).toBe(false);
    expect(report.results.find((result) => result.id === 'PR001')?.status).toBe('failed');
    expect(report.score.score).toBeLessThan(100);
    expect(report.score.score).toBeGreaterThanOrEqual(75);
  });

  it('warns when no tests changed', () => {
    const report = analyse(scenario('no-test-changes').build());
    expect(report.results.find((result) => result.id === 'TEST002')?.status).toBe('failed');
    expect(report.failed).toBe(false);
  });

  it('surfaces a new dependency by name', () => {
    const report = analyse(scenario('dependency-change').build());
    const dependency = report.results.find((result) => result.id === 'DEP001');
    expect(dependency?.status).toBe('failed');
    expect(JSON.stringify(dependency?.data)).toContain('axios');
  });

  it('skips build, tests and the test-change rule for documentation-only work', () => {
    const report = analyse(scenario('documentation-only').build());
    for (const id of ['BUILD001', 'TEST001', 'TEST002']) {
      expect(report.results.find((result) => result.id === id)?.status).toBe('skipped');
    }
    expect(report.score.band).toBe('EXCELLENT');
  });

  it('flags an untouched pull request template as no description', () => {
    const report = analyse(scenario('empty-description').build());
    expect(report.results.find((result) => result.id === 'PR002')?.status).toBe('failed');
  });

  it('finds the duplicate pull request', () => {
    const report = analyse(scenario('potential-duplicate').build());
    const duplicate = report.results.find((result) => result.id === 'DUP001');
    expect(duplicate?.status).toBe('failed');
    expect(JSON.stringify(duplicate?.data)).toContain('183');
  });

  it('puts the everything-at-once pull request firmly in HIGH RISK', () => {
    const report = analyse(scenario('high-risk').build());
    expect(report.score.band).toBe('HIGH RISK');
    expect(report.failed).toBe(true);
  });

  it('renders every scenario to markdown and to a terminal without throwing', () => {
    for (const entry of SCENARIOS) {
      const report = analyse(entry.build());
      const markdown = renderMarkdown(report);
      expect(markdown).toContain('## PRProof Report');
      expect(markdown).toContain(`${report.score.score} / 100`);
      expect(markdown.length).toBeLessThan(60_000);

      const text = renderTerminal(report, { color: false, verbose: true });
      expect(text).toContain('PRProof');
      expect(text).not.toContain('[');
    }
  });

  it('produces byte-identical markdown for the same input', () => {
    const report = analyse(scenario('large-pr').build());
    expect(renderMarkdown(report)).toBe(renderMarkdown(report));
  });
});
