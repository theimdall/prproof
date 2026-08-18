import type { Rule } from '../model/rule.js';
import { buildRule, testRule, lintRule } from './checks.js';
import { documentationOnlyRule } from './documentation-only.js';
import { dependencyChangeRule } from './dependency-change.js';
import { duplicatePullRequestRule } from './duplicate-pr.js';
import { prDescriptionRule } from './pr-description.js';
import { prIssueReferenceRule } from './pr-issue-reference.js';
import { prSizeRule } from './pr-size.js';
import { testChangesRule } from './test-changes.js';

/**
 * Every rule PRProof ships, in report order. The order is part of the output
 * contract: critical gates first, hygiene signals after.
 */
export const RULES: readonly Rule[] = [
  buildRule,
  testRule,
  lintRule,
  prSizeRule,
  testChangesRule,
  dependencyChangeRule,
  duplicatePullRequestRule,
  prDescriptionRule,
  prIssueReferenceRule,
  documentationOnlyRule,
];

export function ruleById(id: string): Rule | undefined {
  return RULES.find((rule) => rule.id === id);
}

export {
  buildRule,
  testRule,
  lintRule,
  prSizeRule,
  testChangesRule,
  dependencyChangeRule,
  duplicatePullRequestRule,
  prDescriptionRule,
  prIssueReferenceRule,
  documentationOnlyRule,
};
