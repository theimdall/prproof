import type { Report } from '../core/model/report.js';
import { renderCheckSummary } from '../core/render/markdown.js';
import { isForbidden, type GitHubApi } from './api.js';

export const CHECK_NAME = 'PRProof';

export type CheckRunAction = 'created' | 'forbidden';

export interface CheckRunResult {
  readonly action: CheckRunAction;
  readonly message: string;
}

/**
 * `neutral` is used deliberately for a low score that is not blocking: a red
 * cross that nobody agreed to be blocked by trains people to ignore red crosses.
 */
export function conclusionFor(report: Report): 'success' | 'failure' | 'neutral' {
  if (report.failed) return 'failure';
  return report.score.band === 'HIGH RISK' || report.score.band === 'REVIEW REQUIRED' ? 'neutral' : 'success';
}

export async function publishCheckRun(api: GitHubApi, report: Report): Promise<CheckRunResult> {
  try {
    await api.createCheckRun({
      name: CHECK_NAME,
      headSha: report.pullRequest.headSha,
      conclusion: conclusionFor(report),
      title: `${report.score.score} / 100 — ${report.score.band}`,
      summary: renderCheckSummary(report),
    });
    return { action: 'created', message: 'Published the PRProof check run.' };
  } catch (error) {
    if (isForbidden(error)) {
      return {
        action: 'forbidden',
        message:
          'The token is not allowed to create check runs (checks: write is required). Skipping the check run.',
      };
    }
    throw error;
  }
}
