import { passed, skipped, type Rule, type RuleResult } from '../model/rule.js';
import type { AnalysisContext } from '../model/context.js';
import { count } from '../render/text.js';

/**
 * Not a gate — a modifier. It never fails and never costs points; it records
 * that the pull request touches documentation only, which is what lets the
 * build, test and test-change rules step aside without silently disappearing.
 */
export const documentationOnlyRule: Rule = {
  id: 'DOC001',
  name: 'Documentation-only',
  severity: 'info',
  description: 'Detects pull requests that change documentation only.',

  evaluate(context: AnalysisContext): RuleResult {
    if (!context.classification.documentationOnly) {
      return skipped(this, 'This pull request changes more than documentation.');
    }
    const skippedChecks = context.config.documentationOnly.skip;
    return passed(
      this,
      'Documentation-only pull request',
      `${count(context.classification.documentationFiles.length, 'documentation file')} changed, nothing else.`,
      {
        details:
          skippedChecks.length > 0
            ? [`Skipped checks: ${skippedChecks.join(', ')}.`]
            : ['No checks were skipped for this pull request.'],
        data: { skipped: skippedChecks },
      },
    );
  },
};
