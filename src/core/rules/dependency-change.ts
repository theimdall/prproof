import { failed, passed, skipped, type Rule, type RuleResult } from '../model/rule.js';
import type { AnalysisContext } from '../model/context.js';
import { count } from '../render/text.js';

/** Penalty multiplier for signals that are informational rather than risky. */
const INFO_FACTOR = 1 / 3;
const MAX_LISTED = 10;

/**
 * A dependency change is not a defect, so this rule never claims one. It exists
 * because adding a dependency is a decision a reviewer should make consciously,
 * and it is easy to miss inside a large diff.
 */
export const dependencyChangeRule: Rule = {
  id: 'DEP001',
  name: 'Dependencies',
  severity: 'warning',
  description: 'Reports newly added dependencies and dependency manifest changes.',

  evaluate(context: AnalysisContext): RuleResult {
    if (!context.config.dependencies.warnOnChange) {
      return skipped(this, 'Dependency reporting is disabled.');
    }

    const report = context.dependencies;
    const touched = report.manifestsChanged.length + report.lockFilesChanged.length;
    if (touched === 0) {
      return passed(this, 'No dependency changes', 'No manifest or lock file changed.');
    }

    if (report.added.length > 0) {
      const listed = report.added.slice(0, MAX_LISTED);
      const remainder = report.added.length - listed.length;
      return failed(
        this,
        report.added.length === 1 ? 'New dependency added' : 'New dependencies added',
        `${count(report.added.length, 'new dependency', 'new dependencies')} detected.`,
        {
          details: [
            ...listed.map(
              (change) =>
                `\`${change.name}${change.version ? ` ${change.version}` : ''}\` — ${change.kind}, from \`${change.manifest}\``,
            ),
            ...(remainder > 0 ? [`…and ${remainder} more.`] : []),
            'Check licence, maintenance status and whether the functionality already exists in the project.',
          ],
          data: { added: report.added, updated: report.updated },
        },
      );
    }

    if (report.incomplete) {
      return failed(
        this,
        'Dependency manifest changed',
        'A dependency manifest changed and PRProof could not determine what changed inside it.',
        {
          severity: 'info',
          penaltyFactor: INFO_FACTOR,
          details: [
            ...report.manifestsChanged.slice(0, MAX_LISTED).map((path) => `\`${path}\``),
            'Review the manifest diff manually.',
          ],
          data: { manifests: report.manifestsChanged, incomplete: true },
        },
      );
    }

    if (report.manifestsChanged.length === 0) {
      return failed(this, 'Lock file updated', 'A lock file changed with no manifest change.', {
        severity: 'info',
        penaltyFactor: INFO_FACTOR,
        details: [
          ...report.lockFilesChanged.slice(0, MAX_LISTED).map((path) => `\`${path}\``),
          'Usually a transitive update. Confirm it was intentional.',
        ],
        data: { lockFiles: report.lockFilesChanged },
      });
    }

    const updatedNote =
      report.updated.length > 0
        ? `${count(report.updated.length, 'dependency version')} changed, none added.`
        : 'Manifests changed without adding dependencies.';

    return passed(this, 'No new dependencies', updatedNote, {
      data: { updated: report.updated, manifests: report.manifestsChanged },
    });
  },
};
