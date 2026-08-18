import { errored, failed, passed, skipped, type Rule, type RuleResult } from '../model/rule.js';
import { downgrade, type Severity } from '../model/severity.js';
import { findCheck, type AnalysisContext } from '../model/context.js';
import type { CheckKind } from '../config/schema.js';

/** Penalty multiplier applied when a failing check is not marked required. */
const NON_REQUIRED_FACTOR = 0.5;

/**
 * Build, test and lint are one mechanism, not three.
 *
 * Each is "did a named command or check run succeed for this head commit?", so
 * they share a single implementation and differ only in identifier, label and
 * declared severity. Adding a fourth check later (type-check, security scan)
 * costs one line here instead of a fourth copy of the same logic.
 */
export function createCheckRule(options: {
  id: string;
  name: string;
  kind: CheckKind;
  severity: Severity;
  description: string;
}): Rule {
  const rule: Rule = {
    id: options.id,
    name: options.name,
    severity: options.severity,
    description: options.description,

    evaluate(context: AnalysisContext): RuleResult {
      const outcome = findCheck(context, options.kind);
      if (!outcome || outcome.source === 'not-configured') {
        return skipped(
          rule,
          `No ${options.kind} command or check name is configured. See docs/configuration.md.`,
        );
      }

      if (
        context.classification.documentationOnly &&
        context.config.documentationOnly.skip.includes(options.kind)
      ) {
        return skipped(rule, `Skipped: documentation-only pull request.`);
      }

      const data = { kind: options.kind, source: outcome.source, detail: outcome.detail };

      switch (outcome.status) {
        case 'passed':
          return passed(rule, `${options.name} passed`, outcome.detail, { data });
        case 'skipped':
          return skipped(rule, outcome.detail);
        case 'unknown':
          // An unknown outcome is never scored. Charging points for a check
          // PRProof could not observe would punish the wrong thing.
          return errored(rule, outcome.detail);
        case 'failed': {
          const severity = outcome.required ? options.severity : downgrade(options.severity);
          const details = [...(outcome.outputTail ?? [])];
          if (!outcome.required) {
            details.push('This check is configured as `required: false`, so its penalty is halved.');
          }
          details.push('Full output is available in the GitHub Actions log for this run.');
          return failed(rule, `${options.name} failed`, outcome.detail, {
            severity,
            penaltyFactor: outcome.required ? 1 : NON_REQUIRED_FACTOR,
            details,
            data,
          });
        }
      }
    },
  };
  return rule;
}

export const buildRule = createCheckRule({
  id: 'BUILD001',
  name: 'Build',
  kind: 'build',
  severity: 'critical',
  description: 'Fails when the build did not succeed for the head commit.',
});

export const testRule = createCheckRule({
  id: 'TEST001',
  name: 'Tests',
  kind: 'test',
  severity: 'critical',
  description: 'Fails when the test suite did not succeed for the head commit.',
});

export const lintRule = createCheckRule({
  id: 'LINT001',
  name: 'Lint',
  kind: 'lint',
  severity: 'high',
  description: 'Fails when the linter did not succeed for the head commit.',
});
