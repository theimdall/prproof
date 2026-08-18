import { describe, expect, it } from 'vitest';

import { analyse } from '../../src/core/engine/engine.js';
import { renderJson } from '../../src/core/render/json.js';
import { renderCheckSummary, statusTextFor } from '../../src/core/render/markdown.js';
import { renderTerminal } from '../../src/core/render/terminal.js';
import { count, pick } from '../../src/core/render/text.js';
import { downgrade, isSeverity, maxSeverity, severityRank } from '../../src/core/model/severity.js';
import {
  collectManifestSnapshots,
  manifestPathsIn,
  MAX_MANIFESTS,
} from '../../src/adapters/diff/manifests.js';
import { DEFAULT_CONFIG } from '../../src/core/config/schema.js';
import { file } from '../fixtures/context.js';
import { scenario } from '../fixtures/scenarios.js';

describe('severity', () => {
  it('orders severities', () => {
    expect(severityRank('info')).toBeLessThan(severityRank('warning'));
    expect(severityRank('warning')).toBeLessThan(severityRank('high'));
    expect(severityRank('high')).toBeLessThan(severityRank('critical'));
  });

  it('recognises its own values only', () => {
    expect(isSeverity('critical')).toBe(true);
    expect(isSeverity('CRITICAL')).toBe(false);
    expect(isSeverity('catastrophic')).toBe(false);
    expect(isSeverity(7)).toBe(false);
  });

  it('finds the highest of a list', () => {
    expect(maxSeverity(['info', 'critical', 'warning'])).toBe('critical');
    expect(maxSeverity(['info'])).toBe('info');
    expect(maxSeverity([])).toBeUndefined();
  });

  it('downgrades one step, and stops at info', () => {
    expect(downgrade('critical')).toBe('high');
    expect(downgrade('high')).toBe('warning');
    expect(downgrade('warning')).toBe('info');
    expect(downgrade('info')).toBe('info');
  });
});

describe('text helpers', () => {
  it('pluralises and formats counts', () => {
    expect(count(1, 'file')).toBe('1 file');
    expect(count(2, 'file')).toBe('2 files');
    expect(count(1500, 'line')).toBe('1,500 lines');
    expect(count(1, 'new dependency', 'new dependencies')).toBe('1 new dependency');
    expect(count(3, 'new dependency', 'new dependencies')).toBe('3 new dependencies');
  });

  it('picks a phrasing', () => {
    expect(pick(1, 'appears', 'appear')).toBe('appears');
    expect(pick(2, 'appears', 'appear')).toBe('appear');
  });
});

describe('json report', () => {
  it('is valid JSON that round-trips the score', () => {
    const report = analyse(scenario('no-test-changes').build());
    const text = renderJson(report);
    expect(text.endsWith('\n')).toBe(true);

    const parsed = JSON.parse(text) as { score: { score: number; band: string }; version: number };
    expect(parsed.version).toBe(1);
    expect(parsed.score.score).toBe(report.score.score);
    expect(parsed.score.band).toBe(report.score.band);
  });
});

describe('check run summary', () => {
  it('leads with the score and lists the findings', () => {
    const summary = renderCheckSummary(analyse(scenario('high-risk').build()));
    expect(summary).toMatch(/^\*\*\d+ \/ 100 — /);
    expect(summary).toContain('TEST001');
    expect(summary.length).toBeLessThan(60_000);
  });

  it('has no findings section when nothing failed', () => {
    const summary = renderCheckSummary(analyse(scenario('small-good-pr').build()));
    expect(summary).not.toContain('### Findings');
  });
});

describe('terminal report', () => {
  it('emits colour only when asked', () => {
    const report = analyse(scenario('failed-tests').build());
    const plain = renderTerminal(report, { color: false, verbose: false });
    const coloured = renderTerminal(report, { color: true, verbose: false });

    expect(plain).not.toContain('[');
    expect(coloured).toContain('[');
  });

  it('hides skipped rules unless verbose', () => {
    const report = analyse(scenario('documentation-only').build());
    expect(renderTerminal(report, { color: false, verbose: false })).not.toContain('SKIP');
    expect(renderTerminal(report, { color: false, verbose: true })).toContain('SKIP');
  });

  it('names every status', () => {
    expect(statusTextFor('passed')).toBe('PASS');
    expect(statusTextFor('failed')).toBe('FAIL');
    expect(statusTextFor('skipped')).toBe('SKIP');
    expect(statusTextFor('errored')).toBe('UNKN');
  });
});

describe('manifest collection', () => {
  it('selects manifests and ignores lock files', () => {
    const files = [file('package.json'), file('package-lock.json'), file('src/a.ts'), file('go.mod')];
    expect(manifestPathsIn(files, DEFAULT_CONFIG)).toEqual(['package.json', 'go.mod']);
  });

  it('caps how many manifests are fetched', () => {
    const files = Array.from({ length: MAX_MANIFESTS + 5 }, (_, index) =>
      file(`packages/p${index}/package.json`),
    );
    expect(manifestPathsIn(files, DEFAULT_CONFIG)).toHaveLength(MAX_MANIFESTS);
  });

  it('keeps a manifest that exists on one side only', async () => {
    const snapshots = await collectManifestSnapshots(
      [file('package.json', { status: 'added' })],
      DEFAULT_CONFIG,
      (_path, ref) => Promise.resolve(ref === 'head' ? '{}' : null),
    );
    expect(snapshots.get('package.json')).toEqual({ before: null, after: '{}' });
  });

  it('drops a manifest that could not be read at all', async () => {
    const snapshots = await collectManifestSnapshots([file('package.json')], DEFAULT_CONFIG, () =>
      Promise.resolve(null),
    );
    expect(snapshots.size).toBe(0);
  });
});
