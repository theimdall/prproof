import type { Report } from '../model/report.js';
import type { RuleResult, RuleStatus } from '../model/rule.js';
import { severityRank, type Severity } from '../model/severity.js';
import { capBody, sanitizeAuthored, sanitizeCell, sanitizeText } from './sanitize.js';
import { count } from './text.js';

/**
 * Hidden marker used to find PRProof's own comment on later runs.
 *
 * Every report carries it, and untrusted text is stripped of HTML comments
 * before rendering, so nothing else in the thread can wear this badge.
 */
export const COMMENT_MARKER = '<!-- prproof:report:v1 -->';

const HOMEPAGE = 'https://github.com/theimdall/prproof';

/** Rules that get a row in the summary table, in display order. */
const TABLE_ROWS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'BUILD001', label: 'Build' },
  { id: 'TEST001', label: 'Tests' },
  { id: 'LINT001', label: 'Lint' },
  { id: 'PR001', label: 'PR size' },
  { id: 'TEST002', label: 'Test changes' },
  { id: 'DEP001', label: 'Dependencies' },
  { id: 'DUP001', label: 'Duplicate PR' },
  { id: 'PR002', label: 'Description' },
  { id: 'PR003', label: 'Linked issue' },
];

function statusCell(result: RuleResult): string {
  switch (result.status) {
    case 'passed':
      return '✅ Passed';
    case 'failed':
      return severityRank(result.severity) >= severityRank('high') ? '❌ Failed' : '⚠️ Warning';
    case 'skipped':
      return '– Skipped';
    case 'errored':
      return '❔ Unknown';
  }
}

function badgeFor(result: RuleResult): string {
  return severityRank(result.severity) >= severityRank('high') ? '❌' : '⚠️';
}

function severityLabel(severity: Severity): string {
  return severity.toUpperCase();
}

function findingsOrder(a: RuleResult, b: RuleResult): number {
  const bySeverity = severityRank(b.severity) - severityRank(a.severity);
  return bySeverity !== 0 ? bySeverity : a.id.localeCompare(b.id);
}

function renderScoreLine(report: Report): string {
  const { score, band } = report.score;
  return `### ${score} / 100 — ${band}`;
}

function renderTable(report: Report): string {
  const byId = new Map(report.results.map((result) => [result.id, result]));
  const lines = ['| Check | Result | Detail |', '| --- | --- | --- |'];

  for (const row of TABLE_ROWS) {
    const result = byId.get(row.id);
    if (!result) continue;
    lines.push(`| ${row.label} | ${statusCell(result)} | ${sanitizeCell(result.summary, 140)} |`);
  }
  return lines.join('\n');
}

function renderFinding(result: RuleResult): string {
  const heading = `#### ${badgeFor(result)} ${sanitizeAuthored(result.title, 160)}`;
  const meta = `\`${result.id}\` · ${severityLabel(result.severity)}`;
  const parts = [heading, '', meta, '', sanitizeAuthored(result.summary, 600)];
  if (result.details && result.details.length > 0) {
    parts.push('');
    for (const detail of result.details.slice(0, 12)) {
      parts.push(`- ${sanitizeAuthored(detail, 400)}`);
    }
  }
  return parts.join('\n');
}

function renderScoreBreakdown(report: Report): string {
  const score = report.score;
  const rows = ['```text', `${String(score.base).padStart(5)}  base`];
  for (const penalty of score.penalties) {
    rows.push(`${String(-penalty.points).padStart(5)}  ${penalty.ruleId.padEnd(9)} ${penalty.title}`);
  }
  if (score.softPenaltyClipped > 0) {
    rows.push(
      `${''.padStart(5)}  (warning budget reached: ${count(score.softPenaltyClipped, 'further point')} not applied)`,
    );
  }
  rows.push('  ---');
  if (score.cap !== null && score.rawScore > score.cap) {
    rows.push(`${String(score.rawScore).padStart(5)}  subtotal`);
    rows.push(`${String(score.cap).padStart(5)}  capped at ${score.cap} because ${score.capReason}`);
  }
  rows.push(`${String(score.score).padStart(5)}  ${score.band}`);
  rows.push('```');

  return [
    '<details>',
    '<summary>How this score was calculated</summary>',
    '',
    rows.join('\n'),
    '',
    `Scoring model: [docs/scoring.md](${HOMEPAGE}/blob/main/docs/scoring.md)`,
    '</details>',
  ].join('\n');
}

function renderSkipped(report: Report): string | null {
  const skipped = report.results.filter(
    (result) => result.status === 'skipped' || result.status === 'errored',
  );
  if (skipped.length === 0) return null;

  const lines = skipped.map(
    (result) =>
      `- \`${result.id}\` ${result.status === 'errored' ? '(could not run)' : '(skipped)'} — ${sanitizeAuthored(result.summary, 300)}`,
  );
  return ['<details>', '<summary>Checks that did not run</summary>', '', ...lines, '</details>'].join('\n');
}

/**
 * Renders the pull request comment.
 *
 * The layout is fixed so that repeated runs produce byte-identical output when
 * nothing changed — that is what lets the comment updater skip the API call and
 * keep the thread quiet.
 */
export function renderMarkdown(report: Report): string {
  const sections: string[] = [COMMENT_MARKER, '## PRProof Report', '', renderScoreLine(report), ''];

  const headline = report.failed
    ? `**Blocking:** ${sanitizeAuthored(report.failReason ?? 'a required check failed', 300)}`
    : null;
  if (headline) sections.push(headline, '');

  sections.push(renderTable(report), '');

  const findings = report.results.filter((result) => result.status === 'failed').sort(findingsOrder);

  if (findings.length > 0) {
    sections.push('### Findings', '');
    for (const finding of findings) {
      sections.push(renderFinding(finding), '');
    }
  }

  const documentationOnly = report.results.find(
    (result) => result.id === 'DOC001' && result.status === 'passed',
  );
  if (documentationOnly) {
    sections.push(`> ${sanitizeAuthored(documentationOnly.summary, 300)}`, '');
  }

  if (report.notes.length > 0) {
    sections.push('### Notes', '');
    for (const note of report.notes.slice(0, 10)) {
      sections.push(`- ${sanitizeText(note, 300)}`);
    }
    sections.push('');
  }

  sections.push(renderScoreBreakdown(report), '');

  const skipped = renderSkipped(report);
  if (skipped) sections.push(skipped, '');

  const sha = report.pullRequest.headSha.slice(0, 7);
  sections.push(
    '---',
    '',
    `<sub>Generated by [PRProof](${HOMEPAGE}) — evidence before merge.${sha ? ` Commit \`${sanitizeCell(sha, 12)}\`.` : ''}</sub>`,
  );

  return capBody(
    sections
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n',
  );
}

/** Compact summary used for the GitHub check run output. */
export function renderCheckSummary(report: Report): string {
  const lines = [`**${report.score.score} / 100 — ${report.score.band}**`, '', renderTable(report)];
  const findings = report.results.filter((result) => result.status === 'failed').sort(findingsOrder);
  if (findings.length > 0) {
    lines.push('', '### Findings', '');
    for (const finding of findings.slice(0, 6)) {
      lines.push(
        `- \`${finding.id}\` **${sanitizeAuthored(finding.title, 120)}** — ${sanitizeAuthored(finding.summary, 200)}`,
      );
    }
  }
  return capBody(lines.join('\n'));
}

export function statusTextFor(status: RuleStatus): string {
  switch (status) {
    case 'passed':
      return 'PASS';
    case 'failed':
      return 'FAIL';
    case 'skipped':
      return 'SKIP';
    case 'errored':
      return 'UNKN';
  }
}
