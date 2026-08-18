import type { Report } from '../model/report.js';

/**
 * The JSON report is the contract between the unprivileged analysis job and the
 * privileged reporting job, and between PRProof and anything a repository wants
 * to build on top of it. It is versioned for that reason.
 */
export function renderJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
