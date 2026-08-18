import type { Config } from '../config/schema.js';
import type { ChangedFile, DependencyChange, DependencyReport } from '../model/context.js';
import { createMatcher, normalisePath } from './match.js';

interface ParsedEntry {
  readonly name: string;
  readonly version: string | null;
  readonly kind: DependencyChange['kind'];
}

interface ManifestParser {
  readonly ecosystem: string;
  /** Returns `null` when the parser does not trust its own reading. */
  parse(patchLines: PatchLine[]): ParsedEntry[] | null;
}

interface PatchLine {
  readonly kind: 'added' | 'removed' | 'context';
  readonly text: string;
}

/** Splits a unified diff into typed lines, dropping headers and hunk markers. */
export function readPatch(patch: string): PatchLine[] {
  const lines: PatchLine[] = [];
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('@@') || raw.startsWith('diff ')) {
      continue;
    }
    if (raw.startsWith('+')) lines.push({ kind: 'added', text: raw.slice(1) });
    else if (raw.startsWith('-')) lines.push({ kind: 'removed', text: raw.slice(1) });
    else lines.push({ kind: 'context', text: raw.startsWith(' ') ? raw.slice(1) : raw });
  }
  return lines;
}

const VERSION_LIKE = /^(\^|~|>|<|=|\*|\d|v\d|workspace:|catalog:|npm:|file:|link:|portal:|git|https?:)/;

const JSON_SECTIONS: Readonly<Record<string, DependencyChange['kind']>> = {
  dependencies: 'runtime',
  require: 'runtime',
  peerDependencies: 'runtime',
  optionalDependencies: 'runtime',
  devDependencies: 'development',
  'require-dev': 'development',
};

/**
 * `package.json` / `composer.json`.
 *
 * Section tracking is intentionally shallow — a diff hunk rarely contains the
 * whole document — and an entry only counts when its *value* looks like a
 * version range, so `"name": "my-app"` is not mistaken for a dependency.
 */
const jsonManifestParser = (ecosystem: string): ManifestParser => ({
  ecosystem,
  parse(lines) {
    const entries: ParsedEntry[] = [];
    let section: DependencyChange['kind'] | null = null;
    for (const line of lines) {
      const header = /^\s*"([A-Za-z-]+)"\s*:\s*\{/.exec(line.text);
      if (header) {
        const name = header[1] ?? '';
        section = JSON_SECTIONS[name] ?? null;
        continue;
      }
      if (/^\s*\},?\s*$/.test(line.text)) {
        section = null;
        continue;
      }
      if (line.kind !== 'added' || section === null) continue;
      const entry = /^\s*"([^"]+)"\s*:\s*"([^"]*)"\s*,?\s*$/.exec(line.text);
      if (!entry) continue;
      const [, name, version] = entry;
      if (!name || version === undefined) continue;
      if (!VERSION_LIKE.test(version) && version !== '') continue;
      entries.push({ name, version: version || null, kind: section });
    }
    return entries;
  },
});

const requirementsParser: ManifestParser = {
  ecosystem: 'pypi',
  parse(lines) {
    const entries: ParsedEntry[] = [];
    for (const line of lines) {
      if (line.kind !== 'added') continue;
      const text = line.text.trim();
      if (text === '' || text.startsWith('#') || text.startsWith('-')) continue;
      const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*([=<>!~].*)?$/.exec(text);
      if (!match) continue;
      const name = match[1];
      if (!name) continue;
      entries.push({ name, version: match[3]?.trim() ?? null, kind: 'runtime' });
    }
    return entries;
  },
};

const pyprojectParser: ManifestParser = {
  ecosystem: 'pypi',
  parse(lines) {
    const entries: ParsedEntry[] = [];
    let devSection = false;
    for (const line of lines) {
      const table = /^\s*\[([^\]]+)\]\s*$/.exec(line.text);
      if (table) {
        const name = (table[1] ?? '').toLowerCase();
        devSection = name.includes('dev') || name.includes('test');
        continue;
      }
      if (line.kind !== 'added') continue;
      const text = line.text.trim();
      // PEP 621 array entry: "requests>=2.0",
      const arrayEntry = /^"([A-Za-z0-9][A-Za-z0-9._-]*)([^"]*)"\s*,?$/.exec(text);
      if (arrayEntry) {
        const name = arrayEntry[1];
        if (!name) continue;
        entries.push({
          name,
          version: (arrayEntry[2] ?? '').trim() || null,
          kind: devSection ? 'development' : 'runtime',
        });
        continue;
      }
      // Poetry table entry: requests = "^2.0"
      const tableEntry = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*["{]/.exec(text);
      if (tableEntry) {
        const name = tableEntry[1];
        if (!name || name === 'python') continue;
        const version = /=\s*"([^"]*)"/.exec(text)?.[1] ?? null;
        entries.push({ name, version, kind: devSection ? 'development' : 'runtime' });
      }
    }
    return entries;
  },
};

const goModParser: ManifestParser = {
  ecosystem: 'go',
  parse(lines) {
    const entries: ParsedEntry[] = [];
    for (const line of lines) {
      if (line.kind !== 'added') continue;
      const text = line.text.trim().replace(/^require\s+/, '');
      const match = /^([a-z0-9][\w.\-/]*\.[\w.\-/]+)\s+(v\S+)/.exec(text);
      if (!match) continue;
      const name = match[1];
      const version = match[2];
      if (!name || !version) continue;
      entries.push({
        name,
        version,
        kind: text.includes('// indirect') ? 'unknown' : 'runtime',
      });
    }
    return entries;
  },
};

const cargoParser: ManifestParser = {
  ecosystem: 'cargo',
  parse(lines) {
    const entries: ParsedEntry[] = [];
    let kind: DependencyChange['kind'] | null = null;
    for (const line of lines) {
      const table = /^\s*\[([^\]]+)\]\s*$/.exec(line.text);
      if (table) {
        const name = (table[1] ?? '').toLowerCase();
        if (name.endsWith('dev-dependencies')) kind = 'development';
        else if (name.endsWith('dependencies') || name.endsWith('build-dependencies')) kind = 'runtime';
        else kind = null;
        continue;
      }
      if (line.kind !== 'added' || kind === null) continue;
      const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(.+)$/.exec(line.text.trim());
      if (!match) continue;
      const name = match[1];
      if (!name) continue;
      const version = /"([^"]+)"/.exec(match[2] ?? '')?.[1] ?? null;
      entries.push({ name, version, kind });
    }
    return entries;
  },
};

const gradleParser: ManifestParser = {
  ecosystem: 'gradle',
  parse(lines) {
    const entries: ParsedEntry[] = [];
    for (const line of lines) {
      if (line.kind !== 'added') continue;
      const match =
        /^\s*(implementation|api|compileOnly|runtimeOnly|testImplementation|annotationProcessor)\s*\(?\s*["']([^"']+)["']/.exec(
          line.text,
        );
      if (!match) continue;
      const coordinate = match[2] ?? '';
      const parts = coordinate.split(':');
      if (parts.length < 2) continue;
      entries.push({
        name: `${parts[0]}:${parts[1]}`,
        version: parts[2] ?? null,
        kind: match[1]?.startsWith('test') ? 'development' : 'runtime',
      });
    }
    return entries;
  },
};

const csprojParser: ManifestParser = {
  ecosystem: 'nuget',
  parse(lines) {
    const entries: ParsedEntry[] = [];
    for (const line of lines) {
      if (line.kind !== 'added') continue;
      const match = /<PackageReference\s+Include="([^"]+)"(?:[^>]*Version="([^"]+)")?/.exec(line.text);
      if (!match) continue;
      const name = match[1];
      if (!name) continue;
      entries.push({ name, version: match[2] ?? null, kind: 'runtime' });
    }
    return entries;
  },
};

const gemfileParser: ManifestParser = {
  ecosystem: 'rubygems',
  parse(lines) {
    const entries: ParsedEntry[] = [];
    for (const line of lines) {
      if (line.kind !== 'added') continue;
      const match = /^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/.exec(line.text);
      if (!match) continue;
      const name = match[1];
      if (!name) continue;
      entries.push({ name, version: match[2] ?? null, kind: 'runtime' });
    }
    return entries;
  },
};

const pubspecParser: ManifestParser = {
  ecosystem: 'pub',
  parse(lines) {
    const entries: ParsedEntry[] = [];
    let kind: DependencyChange['kind'] | null = null;
    for (const line of lines) {
      const header = /^(dev_dependencies|dependencies):\s*$/.exec(line.text);
      if (header) {
        kind = header[1] === 'dev_dependencies' ? 'development' : 'runtime';
        continue;
      }
      if (/^\S/.test(line.text) && !header) kind = null;
      if (line.kind !== 'added' || kind === null) continue;
      const match = /^\s{2,}([A-Za-z0-9_]+):\s*(\S+)?\s*$/.exec(line.text);
      if (!match) continue;
      const name = match[1];
      if (!name || name === 'sdk' || name === 'flutter') continue;
      entries.push({ name, version: match[2] ?? null, kind });
    }
    return entries;
  },
};

/**
 * Manifests with no reliable line-oriented reading. They are still reported as
 * changed, but the report says "could not determine", never "no new
 * dependencies" — a wrong all-clear is worse than an honest unknown.
 */
const unparsedParser = (ecosystem: string): ManifestParser => ({
  ecosystem,
  parse: () => null,
});

function parserFor(path: string): ManifestParser | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (base === 'package.json') return jsonManifestParser('npm');
  if (base === 'composer.json') return jsonManifestParser('packagist');
  if (/^requirements.*\.txt$/.test(base)) return requirementsParser;
  if (base === 'pyproject.toml' || base === 'Pipfile') return pyprojectParser;
  if (base === 'go.mod') return goModParser;
  if (base === 'Cargo.toml') return cargoParser;
  if (base === 'build.gradle' || base === 'build.gradle.kts') return gradleParser;
  if (base.endsWith('.csproj')) return csprojParser;
  if (base === 'Gemfile') return gemfileParser;
  if (base === 'pubspec.yaml') return pubspecParser;
  if (base === 'pom.xml') return unparsedParser('maven');
  return null;
}

/**
 * The two versions of a manifest, when they could be fetched.
 *
 * Whole-file comparison is the only reliable way to read a manifest: a unified
 * diff carries three lines of context, and in a dependency list of any size the
 * `"dependencies": {` header is far above the changed line. Patch parsing alone
 * therefore misses most real additions — the exact case this rule exists for.
 */
export interface ManifestSnapshot {
  readonly before: string | null;
  readonly after: string | null;
}

export type ManifestSnapshots = ReadonlyMap<string, ManifestSnapshot>;

/** Runs a parser over a whole file by presenting every line as an addition. */
function parseWholeFile(parser: ManifestParser, content: string): Map<string, ParsedEntry> | null {
  const lines: PatchLine[] = content.split('\n').map((text) => ({ kind: 'added', text }));
  const entries = parser.parse(lines);
  if (entries === null) return null;
  return new Map(entries.map((entry) => [entry.name, entry]));
}

interface ManifestDiff {
  readonly added: ParsedEntry[];
  readonly updated: ParsedEntry[];
  readonly confident: boolean;
}

function diffSnapshots(parser: ManifestParser, snapshot: ManifestSnapshot): ManifestDiff | null {
  if (snapshot.after === null) return null;
  const after = parseWholeFile(parser, snapshot.after);
  if (after === null) return null;

  // A manifest that did not exist before: everything in it is new.
  const before =
    snapshot.before === null ? new Map<string, ParsedEntry>() : parseWholeFile(parser, snapshot.before);
  if (before === null) return null;

  const added: ParsedEntry[] = [];
  const updated: ParsedEntry[] = [];
  for (const [name, entry] of after) {
    const previous = before.get(name);
    if (previous === undefined) added.push(entry);
    else if (previous.version !== entry.version) updated.push(entry);
  }
  return { added, updated, confident: true };
}

/**
 * Falls back to the diff hunks when the full manifest is unavailable.
 *
 * If the parser recognised no section at all but the hunk clearly contains
 * candidate entries, the result is reported as *not* confident: the report then
 * says it could not determine what changed, rather than claiming nothing did.
 */
function diffPatch(parser: ManifestParser, patch: string): ManifestDiff | null {
  const lines = readPatch(patch);
  const addedEntries = parser.parse(lines);
  if (addedEntries === null) return null;

  const removedNames = new Set((parser.parse(lines.map(flipLine)) ?? []).map((entry) => entry.name));
  const added: ParsedEntry[] = [];
  const updated: ParsedEntry[] = [];
  for (const entry of addedEntries) {
    if (removedNames.has(entry.name)) updated.push(entry);
    else added.push(entry);
  }

  const sawAdditions = lines.some((line) => line.kind === 'added' && line.text.trim() !== '');
  const confident = added.length > 0 || updated.length > 0 || !sawAdditions;
  return { added, updated, confident };
}

/**
 * Determines which dependencies a pull request adds.
 *
 * Lock files are reported as changed but never mined for names: their diffs are
 * enormous, transitively noisy, and derived from the manifest anyway.
 */
export function analyseDependencies(
  files: readonly ChangedFile[],
  config: Config,
  snapshots?: ManifestSnapshots,
): DependencyReport {
  const isLock = createMatcher(config.dependencies.lockPatterns);
  const isManifest = createMatcher(config.dependencies.manifestPatterns);

  const manifestsChanged: string[] = [];
  const lockFilesChanged: string[] = [];
  const added: DependencyChange[] = [];
  const updated: DependencyChange[] = [];
  let incomplete = false;

  for (const file of files) {
    const path = normalisePath(file.path);
    if (isLock(path)) {
      lockFilesChanged.push(path);
      continue;
    }
    if (!isManifest(path)) continue;
    manifestsChanged.push(path);

    if (file.status === 'removed') continue;

    const parser = parserFor(path);
    if (!parser) {
      incomplete = true;
      continue;
    }

    const snapshot = snapshots?.get(path);
    const result =
      (snapshot ? diffSnapshots(parser, snapshot) : null) ??
      (file.patch === undefined || file.patch === '' ? null : diffPatch(parser, file.patch));

    if (result === null) {
      incomplete = true;
      continue;
    }
    if (!result.confident) incomplete = true;

    const toChange = (entry: ParsedEntry): DependencyChange => ({
      manifest: path,
      ecosystem: parser.ecosystem,
      name: entry.name,
      version: entry.version,
      kind: entry.kind,
    });
    added.push(...result.added.map(toChange));
    updated.push(...result.updated.map(toChange));
  }

  return {
    manifestsChanged,
    lockFilesChanged,
    added: dedupe(added),
    updated: dedupe(updated),
    incomplete,
  };
}

/** Re-reads the patch from the "before" side so parsers can be reused as-is. */
function flipLine(line: PatchLine): PatchLine {
  if (line.kind === 'added') return { kind: 'removed', text: line.text };
  if (line.kind === 'removed') return { kind: 'added', text: line.text };
  return line;
}

function dedupe(changes: readonly DependencyChange[]): DependencyChange[] {
  const seen = new Set<string>();
  const out: DependencyChange[] = [];
  for (const change of changes) {
    const key = `${change.manifest}::${change.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(change);
  }
  return out;
}
