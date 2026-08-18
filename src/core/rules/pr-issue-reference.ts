import { failed, passed, skipped, type Rule, type RuleResult } from '../model/rule.js';
import type { AnalysisContext } from '../model/context.js';

export const prIssueReferenceRule: Rule = {
  id: 'PR003',
  name: 'Linked issue',
  severity: 'info',
  description: 'Checks that the pull request references an issue, when required.',

  evaluate(context: AnalysisContext): RuleResult {
    if (!context.config.pullRequest.requireIssueReference) {
      return skipped(this, 'Issue references are not required by this repository.');
    }
    if (context.local) {
      return skipped(this, 'Pull request metadata is not available in local mode.');
    }

    const issues = context.pullRequest.linkedIssues;
    if (issues.length > 0) {
      return passed(this, 'Issue referenced', `References ${issues.map((n) => `#${n}`).join(', ')}.`, {
        data: { issues },
      });
    }

    return failed(this, 'No issue referenced', 'The title and description do not reference an issue.', {
      details: ['Add a reference such as `Closes #123` so the change can be traced back to a request.'],
      data: { issues },
    });
  },
};
