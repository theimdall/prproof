import type { Severity } from '../model/severity.js';

export const CHECK_KINDS = ['build', 'test', 'lint'] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/**
 * How PRProof learns whether the build, tests and linter succeeded.
 *
 * `checks` (default) — PRProof executes nothing. It reads the outcome of steps
 * that already ran in the workflow, or of check runs published for the head
 * commit. This keeps arbitrary command execution out of the product entirely.
 *
 * `run` — PRProof executes the configured commands itself. Convenient, but it
 * turns PRProof into a code execution surface, so it is opt-in and hardened
 * (no shell, executable allowlist, base-branch config, refused in privileged
 * workflow contexts). See docs/security.md.
 */
export type Mode = 'checks' | 'run';

export interface CheckConfig {
  /** Command used in `run` mode. `null` disables the check. */
  readonly command: string | null;
  /** Name of the GitHub check run to read in `checks` mode. */
  readonly checkName: string | null;
  /** A required check that fails is CRITICAL; a non-required one is downgraded. */
  readonly required: boolean;
}

export interface LimitsConfig {
  readonly maxChangedFiles: number;
  readonly maxChangedLines: number;
}

export interface TestsConfig {
  readonly requireTestChanges: boolean;
  readonly patterns: readonly string[];
}

export interface PullRequestConfig {
  readonly minimumDescriptionLength: number;
  readonly requireIssueReference: boolean;
  readonly skipDrafts: boolean;
}

export interface DependenciesConfig {
  readonly warnOnChange: boolean;
  readonly manifestPatterns: readonly string[];
  readonly lockPatterns: readonly string[];
}

export interface DuplicateDetectionConfig {
  readonly enabled: boolean;
  /** Upper bound on open pull requests listed from the API. */
  readonly maxOpenPullRequests: number;
  /** Upper bound on pull requests whose file lists are fetched for comparison. */
  readonly maxComparedPullRequests: number;
  /** Minimum count of shared files before a duplicate is even considered. */
  readonly minSharedFiles: number;
  /** Minimum Jaccard similarity of the two changed-file sets, in `[0, 1]`. */
  readonly minSimilarity: number;
  /** Files excluded from similarity — everyone touches these. */
  readonly ignoredPatterns: readonly string[];
}

export interface DocumentationOnlyConfig {
  readonly patterns: readonly string[];
  /** Checks that are skipped when the pull request is documentation-only. */
  readonly skip: readonly CheckKind[];
}

export interface RunConfig {
  readonly timeoutSeconds: number;
  /** Executables PRProof will start in `run` mode. Anything else is refused. */
  readonly allowedCommands: readonly string[];
  readonly workingDirectory: string;
}

export interface ScoringConfig {
  /** Points removed when a rule fails, before its penalty factor. */
  readonly weights: Readonly<Record<string, number>>;
  /** Ceiling on the total cost of info + warning rules. */
  readonly warningBudget: number;
}

export interface Config {
  readonly version: 1;
  readonly mode: Mode;
  readonly checks: Readonly<Record<CheckKind, CheckConfig>>;
  readonly limits: LimitsConfig;
  readonly tests: TestsConfig;
  readonly pullRequest: PullRequestConfig;
  readonly dependencies: DependenciesConfig;
  readonly duplicateDetection: DuplicateDetectionConfig;
  readonly documentationOnly: DocumentationOnlyConfig;
  readonly run: RunConfig;
  readonly scoring: ScoringConfig;
  /** Severities that make the action exit non-zero. */
  readonly failOn: readonly Severity[];
  /** Post a comment / check run. Disabled automatically without permissions. */
  readonly comment: boolean;
  readonly checkRun: boolean;
}

export const DEFAULT_TEST_PATTERNS: readonly string[] = [
  '**/test/**',
  '**/tests/**',
  '**/__tests__/**',
  '**/testing/**',
  '**/spec/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/test_*.py',
  '**/*_test.py',
  '**/*_test.go',
  '**/*Test.java',
  '**/*Tests.cs',
  '**/*_spec.rb',
  '**/*.feature',
  '**/conftest.py',
];

export const DEFAULT_DOCUMENTATION_PATTERNS: readonly string[] = [
  '**/*.md',
  '**/*.mdx',
  '**/*.rst',
  'docs/**',
  'doc/**',
  'website/**',
  '**/README*',
  'LICENSE*',
  'NOTICE*',
  'CHANGELOG*',
  'CONTRIBUTING*',
  'CODE_OF_CONDUCT*',
  'SECURITY*',
  '.github/ISSUE_TEMPLATE/**',
  '.github/PULL_REQUEST_TEMPLATE*',
];

export const DEFAULT_MANIFEST_PATTERNS: readonly string[] = [
  '**/package.json',
  '**/requirements*.txt',
  '**/pyproject.toml',
  '**/Pipfile',
  '**/go.mod',
  '**/Cargo.toml',
  '**/pom.xml',
  '**/build.gradle',
  '**/build.gradle.kts',
  '**/*.csproj',
  '**/Gemfile',
  '**/composer.json',
  '**/pubspec.yaml',
];

export const DEFAULT_LOCK_PATTERNS: readonly string[] = [
  '**/package-lock.json',
  '**/npm-shrinkwrap.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/bun.lockb',
  '**/poetry.lock',
  '**/Pipfile.lock',
  '**/uv.lock',
  '**/go.sum',
  '**/Cargo.lock',
  '**/packages.lock.json',
  '**/Gemfile.lock',
  '**/composer.lock',
  '**/pubspec.lock',
];

/**
 * Files that almost every pull request touches. Counting them as evidence of
 * duplicated work is the fastest way to generate false positives.
 */
export const DEFAULT_DUPLICATE_IGNORE_PATTERNS: readonly string[] = [
  ...DEFAULT_LOCK_PATTERNS,
  '**/CHANGELOG*',
  '**/README*',
  '**/*.snap',
  '**/.gitignore',
];

/**
 * Executables PRProof is willing to start in `run` mode. Deliberately short:
 * every entry is a build-tool front-end, and none of them is a shell.
 */
export const DEFAULT_ALLOWED_COMMANDS: readonly string[] = [
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'node',
  'deno',
  'python',
  'python3',
  'pytest',
  'ruff',
  'tox',
  'uv',
  'poetry',
  'go',
  'cargo',
  'make',
  'mvn',
  'gradle',
  './gradlew',
  'dotnet',
  'bundle',
  'rake',
  'composer',
  'flutter',
  'swift',
];

/** Default penalty weights, in points. Documented in docs/scoring.md. */
export const DEFAULT_WEIGHTS: Readonly<Record<string, number>> = {
  BUILD001: 40,
  TEST001: 40,
  LINT001: 12,
  TEST002: 15,
  PR001: 12,
  PR002: 12,
  PR003: 4,
  DEP001: 3,
  DUP001: 12,
  DOC001: 0,
};

export const WARNING_BUDGET = 35;

export const DEFAULT_CONFIG: Config = {
  version: 1,
  mode: 'checks',
  checks: {
    build: { command: null, checkName: null, required: true },
    test: { command: null, checkName: null, required: true },
    lint: { command: null, checkName: null, required: false },
  },
  limits: {
    maxChangedFiles: 20,
    maxChangedLines: 1000,
  },
  tests: {
    requireTestChanges: true,
    patterns: DEFAULT_TEST_PATTERNS,
  },
  pullRequest: {
    minimumDescriptionLength: 50,
    requireIssueReference: false,
    skipDrafts: true,
  },
  dependencies: {
    warnOnChange: true,
    manifestPatterns: DEFAULT_MANIFEST_PATTERNS,
    lockPatterns: DEFAULT_LOCK_PATTERNS,
  },
  duplicateDetection: {
    enabled: true,
    maxOpenPullRequests: 50,
    maxComparedPullRequests: 10,
    minSharedFiles: 3,
    minSimilarity: 0.6,
    ignoredPatterns: DEFAULT_DUPLICATE_IGNORE_PATTERNS,
  },
  documentationOnly: {
    patterns: DEFAULT_DOCUMENTATION_PATTERNS,
    skip: ['build', 'test'],
  },
  run: {
    timeoutSeconds: 600,
    allowedCommands: DEFAULT_ALLOWED_COMMANDS,
    workingDirectory: '.',
  },
  scoring: {
    weights: DEFAULT_WEIGHTS,
    warningBudget: WARNING_BUDGET,
  },
  failOn: ['critical'],
  comment: true,
  checkRun: true,
};
