/** Small text helpers shared by the renderers and the rule messages. */

/** `count(1, 'file')` → `1 file`; `count(3, 'file')` → `3 files`. */
export function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? singular : plural}`;
}

/** Chooses between two phrasings without embedding "(s)" in user-facing text. */
export function pick(value: number, singular: string, plural: string): string {
  return value === 1 ? singular : plural;
}
