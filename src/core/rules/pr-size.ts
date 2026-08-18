import { failed, passed, type Rule, type RuleResult } from '../model/rule.js';
import type { AnalysisContext } from '../model/context.js';
import { count } from '../render/text.js';

/** Penalty floor, as a fraction of the configured weight. */
const MIN_FACTOR = 0.5;
/** Overshoot at which the full penalty applies. */
const FULL_PENALTY_AT = 2;

/**
 * Scales the penalty with how far past the limit the pull request is.
 *
 * Ten per cent over the limit and three times over it are not the same problem,
 * and a flat penalty would tell reviewers the same thing in both cases. Crossing
 * the line at all costs half the weight; twice the limit costs all of it.
 */
export function sizeFactor(overshoot: number): number {
  if (overshoot <= 1) return 0;
  const slope = (1 - MIN_FACTOR) / (FULL_PENALTY_AT - 1);
  return Math.min(1, MIN_FACTOR + (overshoot - 1) * slope);
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export const prSizeRule: Rule = {
  id: 'PR001',
  name: 'Pull request size',
  severity: 'warning',
  description: 'Flags pull requests that exceed the configured file or line limits.',

  evaluate(context: AnalysisContext): RuleResult {
    const { limits } = context.config;
    const { truncated } = context.diff;

    // Excluded files — generated bundles, lock files — are diffs a reviewer
    // scrolls past. Counting them would make every dependency bump look like a
    // rewrite, and a repository that commits a build artefact could never pass.
    const excluded = new Set(context.classification.excludedFiles);
    const counted = context.diff.files.filter((file) => !excluded.has(file.path));

    const changedFiles = counted.length;
    const additions = counted.reduce((sum, file) => sum + file.additions, 0);
    const deletions = counted.reduce((sum, file) => sum + file.deletions, 0);
    const changedLines = additions + deletions;

    const fileOvershoot = changedFiles / limits.maxChangedFiles;
    const lineOvershoot = changedLines / limits.maxChangedLines;
    const overshoot = Math.max(fileOvershoot, lineOvershoot);

    const excludedNote = excluded.size > 0 ? ` ${count(excluded.size, 'generated file')} not counted.` : '';
    const summary =
      `${count(changedFiles, 'file')}, ` +
      `+${formatNumber(additions)} / -${formatNumber(deletions)} lines.${excludedNote}`;

    const data = {
      changedFiles,
      additions,
      deletions,
      changedLines,
      truncated,
      excludedFiles: excluded.size,
    };

    if (overshoot <= 1) {
      return passed(this, 'Pull request size is within limits', summary, { data });
    }

    const exceeded: string[] = [];
    if (fileOvershoot > 1) {
      exceeded.push(
        `${formatNumber(changedFiles)} files changed (limit ${formatNumber(limits.maxChangedFiles)})`,
      );
    }
    if (lineOvershoot > 1) {
      exceeded.push(
        `${formatNumber(changedLines)} lines changed (limit ${formatNumber(limits.maxChangedLines)})`,
      );
    }
    if (truncated) {
      exceeded.push('the diff was truncated by the GitHub API, so the real size is larger');
    }

    return failed(this, 'Large pull request', summary, {
      penaltyFactor: sizeFactor(overshoot),
      details: [
        ...exceeded,
        'Large pull requests take longer to review and hide defects. Consider splitting this into smaller, independently reviewable changes.',
      ],
      data,
    });
  },
};
