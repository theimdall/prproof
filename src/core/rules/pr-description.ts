import { failed, passed, skipped, type Rule, type RuleResult } from '../model/rule.js';
import type { AnalysisContext } from '../model/context.js';
import { stripCode } from '../analysis/issues.js';

/**
 * Measures how much a human actually wrote.
 *
 * HTML comments are removed first: pull request templates are mostly comments,
 * and counting them would let an untouched template pass as a description.
 * Checklist markers, headings and code blocks are stripped for the same reason.
 */
export function meaningfulLength(body: string): number {
  const text = stripCode(body)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*#{1,6}\s.*$/gm, ' ')
    .replace(/^\s*[-*]\s*\[[ xX]\]\s*/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length;
}

export const prDescriptionRule: Rule = {
  id: 'PR002',
  name: 'Pull request description',
  severity: 'warning',
  description: 'Flags empty or very short pull request descriptions.',

  evaluate(context: AnalysisContext): RuleResult {
    const minimum = context.config.pullRequest.minimumDescriptionLength;
    if (minimum === 0) {
      return skipped(this, 'No minimum description length is configured.');
    }
    if (context.local) {
      return skipped(this, 'No pull request description is available in local mode.');
    }

    const length = meaningfulLength(context.pullRequest.body);
    const data = { length, minimum };

    if (length >= minimum) {
      return passed(this, 'Description is present', `${length} meaningful characters.`, { data });
    }

    const title = length === 0 ? 'Missing description' : 'Description is very short';
    const detail =
      length === 0
        ? 'This pull request has no description, or only template boilerplate.'
        : `The description contains ${length} meaningful characters; ${minimum} are expected.`;

    return failed(this, title, detail, {
      details: [
        'Describe what changed and why. Reviewers should not have to reconstruct intent from the diff.',
      ],
      data,
    });
  },
};
