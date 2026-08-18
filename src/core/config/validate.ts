import { isSeverity, type Severity } from '../model/severity.js';
import {
  CHECK_KINDS,
  DEFAULT_CONFIG,
  type CheckConfig,
  type CheckKind,
  type Config,
  type Mode,
} from './schema.js';

export interface ConfigIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Configuration problems are reported as a list, not one at a time: a
 * maintainer fixing their `.prproof.yml` should see every mistake in a single
 * run instead of playing whack-a-mole across CI cycles.
 */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const detail = issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');
    super(`Invalid PRProof configuration:\n${detail}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

type Json = Record<string, unknown>;

/**
 * A deliberately small validator instead of a schema library.
 *
 * Configuration parsing is a security boundary (it decides what runs in `run`
 * mode), the shape is fixed and shallow, and hand-written checks produce far
 * better messages than a generic engine. That is worth ~200 lines and one
 * fewer runtime dependency.
 */
class Reader {
  readonly issues: ConfigIssue[] = [];

  fail(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  object(value: unknown, path: string, allowedKeys: readonly string[]): Json {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
      this.fail(path, `expected a mapping, got ${describe(value)}`);
      return {};
    }
    const record = value as Json;
    for (const key of Object.keys(record)) {
      if (!allowedKeys.includes(key)) {
        this.fail(`${path}.${key}`, `unknown option (did you mean one of: ${allowedKeys.join(', ')}?)`);
      }
    }
    return record;
  }

  boolean(value: unknown, path: string, fallback: boolean): boolean {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'boolean') {
      this.fail(path, `expected true or false, got ${describe(value)}`);
      return fallback;
    }
    return value;
  }

  integer(value: unknown, path: string, fallback: number, min: number, max: number): number {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.fail(path, `expected a whole number, got ${describe(value)}`);
      return fallback;
    }
    if (value < min || value > max) {
      this.fail(path, `expected a value between ${min} and ${max}, got ${value}`);
      return fallback;
    }
    return value;
  }

  ratio(value: unknown, path: string, fallback: number): number {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || Number.isNaN(value)) {
      this.fail(path, `expected a number, got ${describe(value)}`);
      return fallback;
    }
    if (value < 0 || value > 1) {
      this.fail(path, `expected a value between 0 and 1, got ${value}`);
      return fallback;
    }
    return value;
  }

  string(value: unknown, path: string, fallback: string): string {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string') {
      this.fail(path, `expected a string, got ${describe(value)}`);
      return fallback;
    }
    return value;
  }

  nullableString(value: unknown, path: string, fallback: string | null): string | null {
    if (value === undefined) return fallback;
    if (value === null) return null;
    if (typeof value !== 'string') {
      this.fail(path, `expected a string, got ${describe(value)}`);
      return fallback;
    }
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  stringArray(value: unknown, path: string, fallback: readonly string[]): readonly string[] {
    if (value === undefined || value === null) return fallback;
    if (!Array.isArray(value)) {
      this.fail(path, `expected a list of strings, got ${describe(value)}`);
      return fallback;
    }
    const out: string[] = [];
    value.forEach((entry, index) => {
      if (typeof entry !== 'string') {
        this.fail(`${path}[${index}]`, `expected a string, got ${describe(entry)}`);
        return;
      }
      out.push(entry);
    });
    return out;
  }

  enum<T extends string>(value: unknown, path: string, allowed: readonly T[], fallback: T): T {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.fail(path, `expected one of: ${allowed.join(', ')}`);
      return fallback;
    }
    return value as T;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return `${typeof value} (${JSON.stringify(value)})`;
}

const TOP_LEVEL_KEYS = [
  'version',
  'mode',
  'build',
  'test',
  'lint',
  'limits',
  'tests',
  'pull_request',
  'dependencies',
  'duplicate_detection',
  'documentation_only',
  'run',
  'scoring',
  'fail_on',
  'comment',
  'check_run',
];

function readCheck(reader: Reader, raw: unknown, kind: CheckKind): CheckConfig {
  const defaults = DEFAULT_CONFIG.checks[kind];
  const node = reader.object(raw, kind, ['command', 'check_name', 'required']);
  return {
    command: reader.nullableString(node['command'], `${kind}.command`, defaults.command),
    checkName: reader.nullableString(node['check_name'], `${kind}.check_name`, defaults.checkName),
    required: reader.boolean(node['required'], `${kind}.required`, defaults.required),
  };
}

/** Validates an already-parsed configuration object. Throws `ConfigError`. */
export function parseConfig(raw: unknown): Config {
  const reader = new Reader();
  const root = reader.object(raw ?? {}, 'root', TOP_LEVEL_KEYS);

  const version = reader.integer(root['version'], 'version', 1, 1, 1);

  const checks = {} as Record<CheckKind, CheckConfig>;
  for (const kind of CHECK_KINDS) {
    checks[kind] = readCheck(reader, root[kind], kind);
  }

  const limitsNode = reader.object(root['limits'], 'limits', ['max_changed_files', 'max_changed_lines']);
  const testsNode = reader.object(root['tests'], 'tests', ['require_test_changes', 'patterns']);
  const prNode = reader.object(root['pull_request'], 'pull_request', [
    'minimum_description_length',
    'require_issue_reference',
    'skip_drafts',
  ]);
  const depsNode = reader.object(root['dependencies'], 'dependencies', [
    'warn_on_change',
    'manifest_patterns',
    'lock_patterns',
  ]);
  const dupNode = reader.object(root['duplicate_detection'], 'duplicate_detection', [
    'enabled',
    'max_open_pull_requests',
    'max_compared_pull_requests',
    'min_shared_files',
    'min_similarity',
    'ignored_patterns',
  ]);
  const docsNode = reader.object(root['documentation_only'], 'documentation_only', ['patterns', 'skip']);
  const runNode = reader.object(root['run'], 'run', [
    'timeout_seconds',
    'allowed_commands',
    'working_directory',
  ]);
  const scoringNode = reader.object(root['scoring'], 'scoring', ['weights', 'warning_budget']);

  const defaults = DEFAULT_CONFIG;

  const weights: Record<string, number> = { ...defaults.scoring.weights };
  const rawWeights = scoringNode['weights'];
  if (rawWeights !== undefined && rawWeights !== null) {
    if (typeof rawWeights !== 'object' || Array.isArray(rawWeights)) {
      reader.fail('scoring.weights', `expected a mapping of rule id to points, got ${describe(rawWeights)}`);
    } else {
      for (const [ruleId, value] of Object.entries(rawWeights as Json)) {
        if (!(ruleId in defaults.scoring.weights)) {
          reader.fail(`scoring.weights.${ruleId}`, 'unknown rule id');
          continue;
        }
        weights[ruleId] = reader.integer(value, `scoring.weights.${ruleId}`, weights[ruleId] ?? 0, 0, 100);
      }
    }
  }

  const failOnRaw = reader.stringArray(root['fail_on'], 'fail_on', defaults.failOn);
  const failOn: Severity[] = [];
  failOnRaw.forEach((entry, index) => {
    const normalised = entry.toLowerCase();
    if (!isSeverity(normalised)) {
      reader.fail(`fail_on[${index}]`, 'expected one of: info, warning, high, critical');
      return;
    }
    failOn.push(normalised);
  });

  const skipRaw = reader.stringArray(
    docsNode['skip'],
    'documentation_only.skip',
    defaults.documentationOnly.skip,
  );
  const skip: CheckKind[] = [];
  skipRaw.forEach((entry, index) => {
    if (!(CHECK_KINDS as readonly string[]).includes(entry)) {
      reader.fail(`documentation_only.skip[${index}]`, `expected one of: ${CHECK_KINDS.join(', ')}`);
      return;
    }
    skip.push(entry as CheckKind);
  });

  const config: Config = {
    version: version as 1,
    mode: reader.enum<Mode>(root['mode'], 'mode', ['checks', 'run'], defaults.mode),
    checks,
    limits: {
      maxChangedFiles: reader.integer(
        limitsNode['max_changed_files'],
        'limits.max_changed_files',
        defaults.limits.maxChangedFiles,
        1,
        100_000,
      ),
      maxChangedLines: reader.integer(
        limitsNode['max_changed_lines'],
        'limits.max_changed_lines',
        defaults.limits.maxChangedLines,
        1,
        10_000_000,
      ),
      exclude: reader.stringArray(limitsNode['exclude'], 'limits.exclude', defaults.limits.exclude),
    },
    tests: {
      requireTestChanges: reader.boolean(
        testsNode['require_test_changes'],
        'tests.require_test_changes',
        defaults.tests.requireTestChanges,
      ),
      patterns: reader.stringArray(testsNode['patterns'], 'tests.patterns', defaults.tests.patterns),
    },
    pullRequest: {
      minimumDescriptionLength: reader.integer(
        prNode['minimum_description_length'],
        'pull_request.minimum_description_length',
        defaults.pullRequest.minimumDescriptionLength,
        0,
        10_000,
      ),
      requireIssueReference: reader.boolean(
        prNode['require_issue_reference'],
        'pull_request.require_issue_reference',
        defaults.pullRequest.requireIssueReference,
      ),
      skipDrafts: reader.boolean(
        prNode['skip_drafts'],
        'pull_request.skip_drafts',
        defaults.pullRequest.skipDrafts,
      ),
    },
    dependencies: {
      warnOnChange: reader.boolean(
        depsNode['warn_on_change'],
        'dependencies.warn_on_change',
        defaults.dependencies.warnOnChange,
      ),
      manifestPatterns: reader.stringArray(
        depsNode['manifest_patterns'],
        'dependencies.manifest_patterns',
        defaults.dependencies.manifestPatterns,
      ),
      lockPatterns: reader.stringArray(
        depsNode['lock_patterns'],
        'dependencies.lock_patterns',
        defaults.dependencies.lockPatterns,
      ),
    },
    duplicateDetection: {
      enabled: reader.boolean(
        dupNode['enabled'],
        'duplicate_detection.enabled',
        defaults.duplicateDetection.enabled,
      ),
      maxOpenPullRequests: reader.integer(
        dupNode['max_open_pull_requests'],
        'duplicate_detection.max_open_pull_requests',
        defaults.duplicateDetection.maxOpenPullRequests,
        1,
        100,
      ),
      maxComparedPullRequests: reader.integer(
        dupNode['max_compared_pull_requests'],
        'duplicate_detection.max_compared_pull_requests',
        defaults.duplicateDetection.maxComparedPullRequests,
        1,
        50,
      ),
      minSharedFiles: reader.integer(
        dupNode['min_shared_files'],
        'duplicate_detection.min_shared_files',
        defaults.duplicateDetection.minSharedFiles,
        1,
        1000,
      ),
      minSimilarity: reader.ratio(
        dupNode['min_similarity'],
        'duplicate_detection.min_similarity',
        defaults.duplicateDetection.minSimilarity,
      ),
      ignoredPatterns: reader.stringArray(
        dupNode['ignored_patterns'],
        'duplicate_detection.ignored_patterns',
        defaults.duplicateDetection.ignoredPatterns,
      ),
    },
    documentationOnly: {
      patterns: reader.stringArray(
        docsNode['patterns'],
        'documentation_only.patterns',
        defaults.documentationOnly.patterns,
      ),
      skip,
    },
    run: {
      timeoutSeconds: reader.integer(
        runNode['timeout_seconds'],
        'run.timeout_seconds',
        defaults.run.timeoutSeconds,
        1,
        21_600,
      ),
      allowedCommands: reader.stringArray(
        runNode['allowed_commands'],
        'run.allowed_commands',
        defaults.run.allowedCommands,
      ),
      workingDirectory: reader.string(
        runNode['working_directory'],
        'run.working_directory',
        defaults.run.workingDirectory,
      ),
    },
    scoring: {
      weights,
      warningBudget: reader.integer(
        scoringNode['warning_budget'],
        'scoring.warning_budget',
        defaults.scoring.warningBudget,
        0,
        100,
      ),
    },
    failOn,
    comment: reader.boolean(root['comment'], 'comment', defaults.comment),
    checkRun: reader.boolean(root['check_run'], 'check_run', defaults.checkRun),
  };

  if (reader.issues.length > 0) {
    throw new ConfigError(reader.issues);
  }
  return config;
}
