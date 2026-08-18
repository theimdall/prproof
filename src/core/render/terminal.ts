import type { Report } from '../model/report.js';
import type { RuleResult } from '../model/rule.js';
import { severityRank } from '../model/severity.js';
import { statusTextFor } from './markdown.js';
import { count } from './text.js';

export interface TerminalOptions {
  readonly color: boolean;
  readonly verbose: boolean;
}

const CODES = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
} as const;

function paint(text: string, code: keyof typeof CODES, options: TerminalOptions): string {
  return options.color ? `${CODES[code]}${text}${CODES.reset}` : text;
}

function statusColor(result: RuleResult): keyof typeof CODES {
  switch (result.status) {
    case 'passed':
      return 'green';
    case 'failed':
      return severityRank(result.severity) >= severityRank('high') ? 'red' : 'yellow';
    default:
      return 'dim';
  }
}

/**
 * Renders the report for a terminal. Plain ASCII status words rather than
 * emoji: this output is read in CI logs, over SSH, and by grep.
 */
export function renderTerminal(report: Report, options: TerminalOptions): string {
  const lines: string[] = [];
  lines.push(paint('PRProof', 'bold', options));
  lines.push('');
  lines.push(`${paint('Score:', 'bold', options)} ${report.score.score} / 100  (${report.score.band})`);
  lines.push('');

  for (const result of report.results) {
    if (!options.verbose && result.status === 'skipped') continue;
    const status = paint(statusTextFor(result.status).padEnd(4), statusColor(result), options);
    lines.push(`${status}  ${result.id.padEnd(9)} ${result.title}`);
    if (result.status === 'failed' || options.verbose) {
      lines.push(`      ${paint(result.summary, 'dim', options)}`);
    }
  }

  const failed = report.results.filter((result) => result.status === 'failed');
  if (failed.length > 0) {
    lines.push('');
    lines.push(paint('Score breakdown', 'bold', options));
    lines.push(`  ${String(report.score.base).padStart(4)}  base`);
    for (const penalty of report.score.penalties) {
      lines.push(`  ${String(-penalty.points).padStart(4)}  ${penalty.ruleId.padEnd(9)} ${penalty.title}`);
    }
    if (report.score.softPenaltyClipped > 0) {
      lines.push(
        `        (warning budget reached: ${count(report.score.softPenaltyClipped, 'further point')} not applied)`,
      );
    }
    if (report.score.cap !== null && report.score.rawScore > report.score.cap) {
      lines.push(`  ${String(report.score.cap).padStart(4)}  capped because ${report.score.capReason}`);
    }
  }

  if (report.notes.length > 0) {
    lines.push('');
    lines.push(paint('Notes', 'bold', options));
    for (const note of report.notes) {
      lines.push(`  - ${note}`);
    }
  }

  lines.push('');
  const verdict = report.failed
    ? paint(`Result: ${report.score.band} — blocking`, 'red', options)
    : paint(`Result: ${report.score.band}`, report.score.score >= 75 ? 'green' : 'yellow', options);
  lines.push(verdict);
  if (report.failReason) {
    lines.push(paint(`  ${report.failReason}`, 'dim', options));
  }

  return `${lines.join('\n')}\n`;
}
