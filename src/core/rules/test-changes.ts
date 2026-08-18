import { failed, passed, skipped, type Rule, type RuleResult } from '../model/rule.js';
import type { AnalysisContext } from '../model/context.js';
import { count } from '../render/text.js';

/** How many example paths are listed in the report before it stops. */
const MAX_LISTED = 5;

export const testChangesRule: Rule = {
  id: 'TEST002',
  name: 'Test changes',
  severity: 'warning',
  description: 'Warns when source files changed but no test files did.',

  evaluate(context: AnalysisContext): RuleResult {
    if (!context.config.tests.requireTestChanges) {
      return skipped(this, 'Test changes are not required by this repository.');
    }
    if (context.classification.documentationOnly) {
      return skipped(this, 'Documentation-only pull request.');
    }
    if (context.diff.truncated) {
      return skipped(this, 'The diff was truncated, so test coverage of the change cannot be judged.');
    }

    const { sourceFiles, testFiles } = context.classification;
    if (sourceFiles.length === 0) {
      return skipped(this, 'No source files changed.');
    }
    if (testFiles.length > 0) {
      return passed(
        this,
        'Tests were updated',
        `${count(testFiles.length, 'test file')} changed alongside ${count(sourceFiles.length, 'source file')}.`,
        { data: { sourceFiles: sourceFiles.length, testFiles: testFiles.length } },
      );
    }

    const examples = sourceFiles.slice(0, MAX_LISTED);
    const remainder = sourceFiles.length - examples.length;

    return failed(
      this,
      'No test files changed',
      `${count(sourceFiles.length, 'source file')} changed and no test file did.`,
      {
        details: [
          ...examples.map((path) => `\`${path}\``),
          ...(remainder > 0 ? [`…and ${count(remainder, 'more source file')}.`] : []),
          'If this change is genuinely untestable, say so in the description so reviewers do not have to ask.',
        ],
        data: { sourceFiles: sourceFiles.length, testFiles: 0 },
      },
    );
  },
};
