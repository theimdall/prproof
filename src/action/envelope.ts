import type { Report, ScoreBreakdown } from '../core/model/report.js';
import type { PullRequestInfo } from '../core/model/context.js';
import type { RuleResult, RuleStatus } from '../core/model/rule.js';
import { isSeverity } from '../core/model/severity.js';
import { bandFor } from '../core/scoring/score.js';

export const ENVELOPE_VERSION = 1;
export const REPORT_FILENAME = 'prproof-report.json';
export const DEFAULT_ARTIFACT_NAME = 'prproof-report';

/** Hard cap on the artifact the privileged job is willing to read. */
export const MAX_ENVELOPE_BYTES = 1024 * 1024;

const MAX_RESULTS = 64;
const MAX_DETAILS = 20;
const MAX_NOTES = 20;

export interface ReportEnvelope {
  readonly version: number;
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
  readonly headSha: string;
  readonly report: Report;
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(`Invalid PRProof report artifact: ${message}`);
    this.name = 'EnvelopeError';
  }
}

/**
 * Rebuilds a report from artifact JSON, field by field.
 *
 * The privileged reporting job reads this file and then writes to the pull
 * request, so the file is treated as untrusted input even though PRProof wrote
 * it: in `run` mode the analysis job also executed repository code, and "our
 * own artifact" is not a security property anyone should rely on. Nothing is
 * passed through — every value is re-validated and re-typed, and unknown fields
 * are dropped rather than forwarded to the renderer.
 */
export function parseEnvelope(text: string): ReportEnvelope {
  if (Buffer.byteLength(text, 'utf8') > MAX_ENVELOPE_BYTES) {
    throw new EnvelopeError(`larger than ${MAX_ENVELOPE_BYTES} bytes`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new EnvelopeError(error instanceof Error ? error.message : 'not valid JSON');
  }
  const root = asRecord(raw, 'root');

  const version = asNumber(root['version'], 'version');
  if (version !== ENVELOPE_VERSION) {
    throw new EnvelopeError(`unsupported version ${version}`);
  }

  const reportNode = asRecord(root['report'], 'report');
  const pullRequestNode = asRecord(reportNode['pullRequest'], 'report.pullRequest');
  const scoreNode = asRecord(reportNode['score'], 'report.score');
  const statsNode = asRecord(reportNode['stats'], 'report.stats');

  const pullRequest: PullRequestInfo = {
    number: asNumberOrNull(pullRequestNode['number']),
    title: asString(pullRequestNode['title'], 'report.pullRequest.title', 500),
    body: '',
    author: asString(pullRequestNode['author'], 'report.pullRequest.author', 100),
    labels: [],
    draft: asBoolean(pullRequestNode['draft']),
    baseRef: asString(pullRequestNode['baseRef'], 'report.pullRequest.baseRef', 250),
    headRef: asString(pullRequestNode['headRef'], 'report.pullRequest.headRef', 250),
    headSha: asString(pullRequestNode['headSha'], 'report.pullRequest.headSha', 64),
    url: null,
    linkedIssues: [],
  };

  const score = parseScore(scoreNode);
  const results = asArray(reportNode['results'], 'report.results')
    .slice(0, MAX_RESULTS)
    .map((entry, index) => parseResult(entry, index));

  const report: Report = {
    version: 1,
    generator: 'prproof',
    pullRequest,
    results,
    checks: [],
    score,
    failed: asBoolean(reportNode['failed']),
    failReason: asStringOrNull(reportNode['failReason'], 500),
    notes: asArray(reportNode['notes'], 'report.notes')
      .slice(0, MAX_NOTES)
      .map((note, index) => asString(note, `report.notes[${index}]`, 300)),
    stats: {
      changedFiles: asNumber(statsNode['changedFiles'], 'report.stats.changedFiles'),
      additions: asNumber(statsNode['additions'], 'report.stats.additions'),
      deletions: asNumber(statsNode['deletions'], 'report.stats.deletions'),
      truncated: asBoolean(statsNode['truncated']),
    },
  };

  return {
    version,
    owner: asString(root['owner'], 'owner', 100),
    repo: asString(root['repo'], 'repo', 100),
    pullNumber: asNumber(root['pullNumber'], 'pullNumber'),
    headSha: asString(root['headSha'], 'headSha', 64),
    report,
  };
}

function parseScore(node: Record<string, unknown>): ScoreBreakdown {
  const score = clamp(asNumber(node['score'], 'report.score.score'), 0, 100);
  const penalties = asArray(node['penalties'], 'report.score.penalties')
    .slice(0, MAX_RESULTS)
    .map((entry, index) => {
      const penalty = asRecord(entry, `report.score.penalties[${index}]`);
      return {
        ruleId: asString(penalty['ruleId'], 'ruleId', 20),
        title: asString(penalty['title'], 'title', 200),
        severity: asString(penalty['severity'], 'severity', 20),
        points: clamp(asNumber(penalty['points'], 'points'), 0, 100),
      };
    });

  return {
    base: clamp(asNumber(node['base'], 'report.score.base'), 0, 100),
    penalties,
    softPenalty: clamp(asNumber(node['softPenalty'], 'report.score.softPenalty'), 0, 1000),
    softPenaltyClipped: clamp(
      asNumber(node['softPenaltyClipped'], 'report.score.softPenaltyClipped'),
      0,
      1000,
    ),
    hardPenalty: clamp(asNumber(node['hardPenalty'], 'report.score.hardPenalty'), 0, 1000),
    rawScore: clamp(asNumber(node['rawScore'], 'report.score.rawScore'), -1000, 100),
    cap: node['cap'] === null ? null : clamp(asNumber(node['cap'], 'report.score.cap'), 0, 100),
    capReason: asStringOrNull(node['capReason'], 200),
    score,
    // Recomputed rather than trusted: the band must always agree with the score.
    band: bandFor(score),
  };
}

const STATUSES: readonly RuleStatus[] = ['passed', 'failed', 'skipped', 'errored'];

function parseResult(entry: unknown, index: number): RuleResult {
  const node = asRecord(entry, `report.results[${index}]`);
  const status = asString(node['status'], `report.results[${index}].status`, 20);
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw new EnvelopeError(`report.results[${index}].status is not a known status`);
  }
  const severity = asString(node['severity'], `report.results[${index}].severity`, 20);
  if (!isSeverity(severity)) {
    throw new EnvelopeError(`report.results[${index}].severity is not a known severity`);
  }

  const details =
    node['details'] === undefined
      ? undefined
      : asArray(node['details'], `report.results[${index}].details`)
          .slice(0, MAX_DETAILS)
          .map((detail, detailIndex) =>
            asString(detail, `report.results[${index}].details[${detailIndex}]`, 500),
          );

  return {
    id: asString(node['id'], `report.results[${index}].id`, 20),
    name: asString(node['name'], `report.results[${index}].name`, 100),
    status: status as RuleStatus,
    severity: severity,
    title: asString(node['title'], `report.results[${index}].title`, 200),
    summary: asString(node['summary'], `report.results[${index}].summary`, 600),
    ...(details === undefined ? {} : { details }),
  };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EnvelopeError(`${path} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new EnvelopeError(`${path} is not an array`);
  return value;
}

function asString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string') throw new EnvelopeError(`${path} is not a string`);
  return value.slice(0, maxLength);
}

function asStringOrNull(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  return value.slice(0, maxLength);
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EnvelopeError(`${path} is not a finite number`);
  }
  return value;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Serialises the envelope written by the analysis job. */
export function serialiseEnvelope(envelope: ReportEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
