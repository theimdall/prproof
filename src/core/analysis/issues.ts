/** Upper bound on referenced issues kept per pull request. */
const MAX_REFERENCES = 20;

/**
 * Removes fenced and inline code so that a `#1234` inside a snippet is not
 * mistaken for an issue reference.
 */
export function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

/**
 * Extracts issue numbers referenced from free text: `#123`, `GH-123`, and full
 * issue URLs. Pull request URLs are ignored — linking a pull request is not
 * evidence that an issue is being addressed.
 */
export function extractIssueReferences(...texts: readonly string[]): number[] {
  const found = new Set<number>();
  const source = stripCode(texts.join('\n'));

  for (const match of source.matchAll(/(?:^|[^\w/&])#(\d{1,7})\b/g)) {
    add(found, match[1]);
  }
  for (const match of source.matchAll(/\bGH-(\d{1,7})\b/gi)) {
    add(found, match[1]);
  }
  for (const match of source.matchAll(
    /https?:\/\/[\w.-]*github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d{1,7})\b/gi,
  )) {
    add(found, match[1]);
  }

  return [...found].sort((a, b) => a - b).slice(0, MAX_REFERENCES);
}

function add(set: Set<number>, raw: string | undefined): void {
  if (raw === undefined) return;
  const value = Number.parseInt(raw, 10);
  if (Number.isInteger(value) && value > 0) set.add(value);
}
