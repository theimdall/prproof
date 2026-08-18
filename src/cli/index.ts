import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { resolveChecks } from '../adapters/checks/resolve.js';
import {
  guessBaseBranch,
  isGitRepository,
  loadGitDiff,
  mergeBase,
  readFileAtRef,
  readLocalHead,
} from '../adapters/diff/git.js';
import { collectManifestSnapshots } from '../adapters/diff/manifests.js';
import { createMatcher } from '../core/analysis/match.js';
import { extractIssueReferences } from '../core/analysis/issues.js';
import { CONFIG_FILENAMES, parseConfigText } from '../core/config/load.js';
import { ConfigError } from '../core/config/validate.js';
import { DEFAULT_CONFIG, type Config } from '../core/config/schema.js';
import { analyse } from '../core/engine/engine.js';
import { buildContext } from '../core/engine/build-context.js';
import type { PullRequestInfo } from '../core/model/context.js';
import { renderJson } from '../core/render/json.js';
import { renderMarkdown } from '../core/render/markdown.js';
import { renderTerminal } from '../core/render/terminal.js';
import { RULES } from '../core/rules/registry.js';

const VERSION = '0.1.1';

const USAGE = `prproof — evidence before merge

Usage:
  prproof analyze [options]
  prproof rules
  prproof --version

Options:
  --base <ref>       Base branch to compare against (default: detected)
  --head <ref>       Head revision to analyse (default: HEAD)
  --config <path>    Path to a .prproof.yml (default: found in the repository root)
  --cwd <path>       Repository directory (default: current directory)
  --format <fmt>     text | json | markdown (default: text)
  --run              Execute the configured build/test/lint commands locally
  --verbose          Show skipped checks and per-check detail
  --no-color         Disable ANSI colour
  --no-fail          Always exit 0, whatever the result

Exit codes:
  0  analysis completed and nothing blocking was found
  1  a check matching fail_on failed
  2  PRProof could not run (bad configuration, not a git repository, ...)
`;

interface CliOptions {
  readonly command: 'analyze' | 'rules' | 'help' | 'version';
  readonly base?: string;
  readonly head: string;
  readonly config?: string;
  readonly cwd: string;
  readonly format: 'text' | 'json' | 'markdown';
  readonly run: boolean;
  readonly verbose: boolean;
  readonly color: boolean;
  readonly fail: boolean;
}

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): CliOptions {
  let command: CliOptions['command'] = 'analyze';
  let base: string | undefined;
  let head = 'HEAD';
  let config: string | undefined;
  let cwd = process.cwd();
  let format: CliOptions['format'] = 'text';
  let run = false;
  let verbose = false;
  let color = process.env['NO_COLOR'] === undefined;
  let fail = true;

  const rest = [...argv];
  const first = rest[0];
  if (first !== undefined && !first.startsWith('-')) {
    if (first === 'analyze' || first === 'rules') {
      command = first;
    } else {
      throw new UsageError(`unknown command "${first}"`);
    }
    rest.shift();
  }

  while (rest.length > 0) {
    const arg = rest.shift() as string;
    const value = (): string => {
      const next = rest.shift();
      if (next === undefined) throw new UsageError(`${arg} requires a value`);
      return next;
    };

    switch (arg) {
      case '--base':
        base = value();
        break;
      case '--head':
        head = value();
        break;
      case '--config':
        config = value();
        break;
      case '--cwd':
        cwd = path.resolve(value());
        break;
      case '--format': {
        const format_ = value();
        if (format_ !== 'text' && format_ !== 'json' && format_ !== 'markdown') {
          throw new UsageError(`--format must be text, json or markdown (got "${format_}")`);
        }
        format = format_;
        break;
      }
      case '--run':
        run = true;
        break;
      case '--verbose':
        verbose = true;
        break;
      case '--no-color':
        color = false;
        break;
      case '--no-fail':
        fail = false;
        break;
      case '-h':
      case '--help':
        command = 'help';
        break;
      case '-v':
      case '--version':
        command = 'version';
        break;
      default:
        throw new UsageError(`unknown option "${arg}"`);
    }
  }

  return {
    command,
    ...(base === undefined ? {} : { base }),
    head,
    ...(config === undefined ? {} : { config }),
    cwd,
    format,
    run,
    verbose,
    color,
    fail,
  };
}

async function readConfig(options: CliOptions): Promise<{ config: Config; source: string }> {
  const candidates = options.config
    ? [path.resolve(options.cwd, options.config)]
    : CONFIG_FILENAMES.map((name) => path.join(options.cwd, name));

  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate, 'utf8');
      return { config: parseConfigText(text, candidate), source: candidate };
    } catch (error) {
      if (isMissingFile(error)) continue;
      throw error;
    }
  }

  if (options.config) {
    throw new UsageError(`configuration file not found: ${options.config}`);
  }
  return { config: DEFAULT_CONFIG, source: 'built-in defaults' };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'ENOENT'
  );
}

function listRules(): string {
  const lines = ['PRProof rules', ''];
  for (const rule of RULES) {
    lines.push(`${rule.id.padEnd(9)} ${rule.severity.toUpperCase().padEnd(9)} ${rule.name}`);
    lines.push(`          ${rule.description}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function run(
  argv: readonly string[],
  stdout: NodeJS.WritableStream = process.stdout,
): Promise<number> {
  const options = parseArgs(argv);

  if (options.command === 'help') {
    stdout.write(USAGE);
    return 0;
  }
  if (options.command === 'version') {
    stdout.write(`prproof ${VERSION}\n`);
    return 0;
  }
  if (options.command === 'rules') {
    stdout.write(listRules());
    return 0;
  }

  if (!(await isGitRepository(options.cwd))) {
    throw new UsageError(`${options.cwd} is not a git repository`);
  }

  const { config: fileConfig, source } = await readConfig(options);
  const config: Config = options.run ? { ...fileConfig, mode: 'run' } : fileConfig;

  const notes: string[] = [];
  if (source === 'built-in defaults') {
    notes.push('No .prproof.yml was found; built-in defaults were used.');
  }

  const base = options.base ?? (await guessBaseBranch(options.cwd));
  const isManifest = createMatcher([
    ...config.dependencies.manifestPatterns,
    ...config.dependencies.lockPatterns,
  ]);

  const diff = await loadGitDiff({
    cwd: options.cwd,
    base,
    head: options.head,
    patchFilter: isManifest,
  });

  const mergeBaseSha = await mergeBase(base, options.head, options.cwd);
  const manifestSnapshots = await collectManifestSnapshots(diff.files, config, (path, ref) =>
    readFileAtRef(options.cwd, ref === 'base' ? mergeBaseSha : options.head, path),
  );

  const head = await readLocalHead(options.cwd);
  const pullRequest: PullRequestInfo = {
    number: null,
    title: head.subject,
    body: head.body,
    author: 'local',
    labels: [],
    draft: false,
    baseRef: base,
    headRef: head.branch,
    headSha: head.sha,
    url: null,
    linkedIssues: extractIssueReferences(head.subject, head.body),
  };

  const checks = await resolveChecks({
    config,
    inputs: {},
    checkRuns: null,
    execution: config.mode === 'run' ? { workspace: options.cwd } : null,
    notes,
  });

  const context = buildContext({
    config,
    pullRequest,
    diff,
    checks,
    local: true,
    openPullRequestsAvailable: false,
    manifestSnapshots,
    notes,
  });

  const report = analyse(context);

  switch (options.format) {
    case 'json':
      stdout.write(renderJson(report));
      break;
    case 'markdown':
      stdout.write(renderMarkdown(report));
      break;
    case 'text':
      stdout.write(renderTerminal(report, { color: options.color, verbose: options.verbose }));
      break;
  }

  if (!options.fail) return 0;
  return report.failed ? 1 : 0;
}

/** Entry point used by `bin/prproof.js`. */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`prproof: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`prproof: ${message}\n`);
    return 2;
  }
}
