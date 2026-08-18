import { describe, expect, it } from 'vitest';

import { analyse } from '../../src/core/engine/engine.js';
import {
  ENVELOPE_VERSION,
  EnvelopeError,
  parseEnvelope,
  serialiseEnvelope,
  type ReportEnvelope,
} from '../../src/action/envelope.js';
import { renderMarkdown } from '../../src/core/render/markdown.js';
import { scenario } from '../fixtures/scenarios.js';

function envelope(): ReportEnvelope {
  return {
    version: ENVELOPE_VERSION,
    owner: 'acme',
    repo: 'widgets',
    pullNumber: 42,
    headSha: 'a'.repeat(40),
    report: analyse(scenario('no-test-changes').build()),
  };
}

describe('report envelope', () => {
  it('round-trips a real report', () => {
    const original = envelope();
    const parsed = parseEnvelope(serialiseEnvelope(original));
    expect(parsed.pullNumber).toBe(42);
    expect(parsed.report.score.score).toBe(original.report.score.score);
    expect(parsed.report.results).toHaveLength(original.report.results.length);
    expect(renderMarkdown(parsed.report)).toContain('No test files changed');
  });

  it('rejects a different envelope version', () => {
    const text = serialiseEnvelope({ ...envelope(), version: 99 });
    expect(() => parseEnvelope(text)).toThrow(EnvelopeError);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseEnvelope('{not json')).toThrow(EnvelopeError);
  });

  it('rejects an oversized artifact', () => {
    const padded = JSON.stringify({ version: 1, pad: 'x'.repeat(2 * 1024 * 1024) });
    expect(() => parseEnvelope(padded)).toThrow(/larger than/);
  });

  it('rejects unknown statuses and severities', () => {
    const broken = JSON.parse(serialiseEnvelope(envelope())) as Record<string, unknown>;
    const report = broken['report'] as { results: Record<string, unknown>[] };
    report.results[0] = { ...report.results[0], status: 'excellent' };
    expect(() => parseEnvelope(JSON.stringify(broken))).toThrow(/status/);
  });

  it('drops unknown fields instead of forwarding them', () => {
    const broken = JSON.parse(serialiseEnvelope(envelope())) as Record<string, unknown>;
    const report = broken['report'] as Record<string, unknown>;
    report['injected'] = '<script>alert(1)</script>';
    const parsed = parseEnvelope(JSON.stringify(broken));
    expect(JSON.stringify(parsed)).not.toContain('injected');
  });

  it('recomputes the band so it cannot disagree with the score', () => {
    const broken = JSON.parse(serialiseEnvelope(envelope())) as Record<string, unknown>;
    const report = broken['report'] as Record<string, unknown>;
    const score = report['score'] as Record<string, unknown>;
    score['score'] = 12;
    score['band'] = 'EXCELLENT';
    expect(parseEnvelope(JSON.stringify(broken)).report.score.band).toBe('HIGH RISK');
  });

  it('clamps out-of-range numbers', () => {
    const broken = JSON.parse(serialiseEnvelope(envelope())) as Record<string, unknown>;
    const report = broken['report'] as Record<string, unknown>;
    const score = report['score'] as Record<string, unknown>;
    score['score'] = 10_000;
    expect(parseEnvelope(JSON.stringify(broken)).report.score.score).toBe(100);
  });

  it('truncates long strings from the artifact', () => {
    const broken = JSON.parse(serialiseEnvelope(envelope())) as Record<string, unknown>;
    const report = broken['report'] as { results: Record<string, unknown>[] };
    report.results[0] = { ...report.results[0], title: 'x'.repeat(5000) };
    const parsed = parseEnvelope(JSON.stringify(broken));
    expect(parsed.report.results[0]?.title.length).toBeLessThanOrEqual(200);
  });

  it('rejects a report that is not an object', () => {
    expect(() => parseEnvelope(JSON.stringify({ version: 1, report: 'nope' }))).toThrow(EnvelopeError);
  });
});
