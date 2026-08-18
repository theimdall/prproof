import { failed, passed, skipped, type Rule, type RuleResult } from '../model/rule.js';
import type { AnalysisContext } from '../model/context.js';
import { findDuplicates, type DuplicateCandidate } from '../analysis/duplicates.js';
import { count, pick } from '../render/text.js';

/** At most this many candidates are reported; the rest would be noise. */
const MAX_REPORTED = 3;

/** One markdown list item per candidate, with the evidence nested under it. */
function describeCandidate(candidate: DuplicateCandidate): string {
  const pr = candidate.pullRequest;
  const lines = [`[#${pr.number} ${pr.title}](${pr.url}) by ${pr.author}`];

  if (candidate.sharedIssues.length > 0) {
    const issues = candidate.sharedIssues.map((issue) => `#${issue}`).join(', ');
    lines.push(`  - Both reference ${pick(candidate.sharedIssues.length, 'issue', 'issues')} ${issues}.`);
  }
  if (candidate.sharedFiles.length > 0) {
    const percent = Math.round(candidate.similarity * 100);
    const preview = candidate.sharedFiles
      .slice(0, 5)
      .map((file) => `\`${file}\``)
      .join(', ');
    const more = candidate.sharedFiles.length > 5 ? ', …' : '';
    lines.push(
      `  - ${count(candidate.sharedFiles.length, 'shared file')}, ${percent}% overlap: ${preview}${more}`,
    );
  }
  return lines.join('\n');
}

export const duplicatePullRequestRule: Rule = {
  id: 'DUP001',
  name: 'Duplicate pull request',
  severity: 'warning',
  description: 'Flags open pull requests that appear to cover the same work.',

  evaluate(context: AnalysisContext): RuleResult {
    const config = context.config.duplicateDetection;
    if (!config.enabled) {
      return skipped(this, 'Duplicate detection is disabled.');
    }
    if (!context.openPullRequestsAvailable) {
      return skipped(this, 'Open pull requests could not be listed, so duplicates were not checked.');
    }
    if (context.diff.truncated) {
      return skipped(this, 'The diff was truncated, so file overlap cannot be compared reliably.');
    }

    const candidates = findDuplicates(
      {
        number: context.pullRequest.number,
        baseRef: context.pullRequest.baseRef,
        headRef: context.pullRequest.headRef,
        files: context.diff.files.map((file) => file.path),
        linkedIssues: context.pullRequest.linkedIssues,
      },
      context.openPullRequests,
      config,
    );

    if (candidates.length === 0) {
      return passed(
        this,
        'No duplicate detected',
        `Compared against ${count(context.openPullRequests.length, 'open pull request')}.`,
      );
    }

    const reported = candidates.slice(0, MAX_REPORTED);
    return failed(
      this,
      reported.length === 1 ? 'Possible duplicate pull request' : 'Possible duplicate pull requests',
      `${count(candidates.length, 'open pull request')} ${pick(candidates.length, 'appears', 'appear')} to overlap with this one.`,
      {
        details: [
          ...reported.map(describeCandidate),
          'This is a heuristic. If the overlap is intentional, ignore this warning.',
        ],
        data: {
          candidates: reported.map((candidate) => ({
            number: candidate.pullRequest.number,
            similarity: Number(candidate.similarity.toFixed(3)),
            sharedFiles: candidate.sharedFiles.length,
            sharedIssues: candidate.sharedIssues,
            reason: candidate.reason,
          })),
        },
      },
    );
  },
};
