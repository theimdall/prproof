import picomatch from 'picomatch';

export type Matcher = (path: string) => boolean;

/**
 * Builds a glob matcher over repository-relative POSIX paths.
 *
 * `dot: true` matters: without it `.github/**` silently matches nothing, which
 * would turn a configured pattern into a rule that never fires.
 */
export function createMatcher(patterns: readonly string[]): Matcher {
  if (patterns.length === 0) return () => false;
  const isMatch = picomatch([...patterns], { dot: true, nocase: false });
  return (path: string) => isMatch(normalisePath(path));
}

/** Normalises separators so Windows-produced diffs match POSIX patterns. */
export function normalisePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}
