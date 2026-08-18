import type { DuplicateDetectionConfig } from '../config/schema.js';
import type { OpenPullRequest } from '../model/context.js';
import { createMatcher, normalisePath } from './match.js';

export interface DuplicateCandidate {
  readonly pullRequest: OpenPullRequest;
  readonly sharedFiles: readonly string[];
  readonly comparedFiles: number;
  /** Jaccard similarity of the two filtered file sets, in `[0, 1]`. */
  readonly similarity: number;
  readonly sharedIssues: readonly number[];
  readonly reason: 'shared-issue' | 'shared-files' | 'both';
}

export interface DuplicateSubject {
  readonly number: number | null;
  readonly baseRef: string;
  readonly headRef: string;
  readonly files: readonly string[];
  readonly linkedIssues: readonly number[];
}

/**
 * Deterministic duplicate detection. Two signals only:
 *
 *  1. both pull requests reference the same issue;
 *  2. their changed-file sets overlap heavily.
 *
 * Title similarity is deliberately absent. "Fix typo", "Update deps" and
 * "Bump version" are near-identical strings on unrelated work, and a wrong
 * duplicate warning costs more trust than a missed one saves time.
 */
export function findDuplicates(
  subject: DuplicateSubject,
  others: readonly OpenPullRequest[],
  config: DuplicateDetectionConfig,
): DuplicateCandidate[] {
  const isIgnored = createMatcher(config.ignoredPatterns);
  const subjectFiles = filterFiles(subject.files, isIgnored);
  const subjectIssues = new Set(subject.linkedIssues);

  const candidates: DuplicateCandidate[] = [];

  for (const other of others) {
    if (subject.number !== null && other.number === subject.number) continue;
    // Stacked pull requests share files by construction, not by duplication.
    if (other.baseRef === subject.headRef || other.headRef === subject.baseRef) continue;

    const sharedIssues = other.linkedIssues.filter((issue) => subjectIssues.has(issue));

    let sharedFiles: string[] = [];
    let similarity = 0;
    let comparedFiles = 0;

    if (other.files !== null) {
      const otherFiles = filterFiles(other.files, isIgnored);
      comparedFiles = otherFiles.size;
      sharedFiles = [...subjectFiles].filter((file) => otherFiles.has(file)).sort();
      similarity = jaccard(subjectFiles, otherFiles);
    }

    const fileSignal = sharedFiles.length >= config.minSharedFiles && similarity >= config.minSimilarity;
    const issueSignal = sharedIssues.length > 0;
    if (!fileSignal && !issueSignal) continue;

    candidates.push({
      pullRequest: other,
      sharedFiles,
      comparedFiles,
      similarity,
      sharedIssues,
      reason: issueSignal && fileSignal ? 'both' : issueSignal ? 'shared-issue' : 'shared-files',
    });
  }

  return candidates.sort((a, b) => rank(b) - rank(a));
}

function rank(candidate: DuplicateCandidate): number {
  const issueWeight = candidate.sharedIssues.length > 0 ? 1 : 0;
  return issueWeight * 2 + candidate.similarity;
}

function filterFiles(files: readonly string[], isIgnored: (path: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    const path = normalisePath(file);
    if (!isIgnored(path)) out.add(path);
  }
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
