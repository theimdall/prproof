import type { ManifestSnapshot, ManifestSnapshots } from '../../core/analysis/dependencies.js';
import { createMatcher, normalisePath } from '../../core/analysis/match.js';
import type { ChangedFile } from '../../core/model/context.js';
import type { Config } from '../../core/config/schema.js';

/**
 * Upper bound on manifests fetched in full. Two reads each, and a pull request
 * that changes more than this many manifests has a bigger story than DEP001.
 */
export const MAX_MANIFESTS = 10;

/** Reads one file at one revision. Returns `null` when it does not exist. */
export type FileReader = (path: string, ref: 'base' | 'head') => Promise<string | null>;

/** Manifest paths in a diff, in order, capped. */
export function manifestPathsIn(files: readonly ChangedFile[], config: Config): string[] {
  const isManifest = createMatcher(config.dependencies.manifestPatterns);
  const isLock = createMatcher(config.dependencies.lockPatterns);
  const paths: string[] = [];
  for (const file of files) {
    const path = normalisePath(file.path);
    if (isLock(path) || !isManifest(path)) continue;
    paths.push(path);
    if (paths.length >= MAX_MANIFESTS) break;
  }
  return paths;
}

/**
 * Fetches both versions of every changed manifest.
 *
 * A failure to read one side is not an error: `null` means "not present", and
 * the dependency analyser falls back to patch parsing — and says so — when a
 * snapshot is missing entirely.
 */
export async function collectManifestSnapshots(
  files: readonly ChangedFile[],
  config: Config,
  read: FileReader,
): Promise<ManifestSnapshots> {
  const snapshots = new Map<string, ManifestSnapshot>();

  for (const path of manifestPathsIn(files, config)) {
    const [before, after] = await Promise.all([read(path, 'base'), read(path, 'head')]);
    if (after === null && before === null) continue;
    snapshots.set(path, { before, after });
  }
  return snapshots;
}
