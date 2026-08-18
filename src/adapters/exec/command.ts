import { spawn } from 'node:child_process';
import path from 'node:path';

import { redactSecrets } from '../../core/render/sanitize.js';

/**
 * Command execution is the one place where PRProof can be turned into a weapon,
 * so everything in this file is written to fail closed.
 *
 * The design rests on four decisions:
 *
 *  1. No shell, ever. Commands are parsed into `argv` here and handed to
 *     `spawn` with `shell: false`, so there is no interpreter to inject into.
 *  2. Shell metacharacters are a parse error, not something to escape. If a
 *     configuration wants `a && b`, that is two checks, not one string.
 *  3. `argv[0]` must be on an allowlist of build-tool front-ends.
 *  4. Execution is refused outright in privileged workflow contexts.
 */

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface ParsedCommand {
  readonly file: string;
  readonly args: readonly string[];
  /** The command as PRProof will run it, for display in the report. */
  readonly display: string;
}

/** Characters that only mean something to a shell. Their presence is a bug. */
const FORBIDDEN = /[;&|`$(){}<>\n\r\\!]/;

/**
 * Splits a command string into `argv`, honouring simple quoting.
 *
 * Quoting exists so that `pytest -k "my test"` works. It is not an escaping
 * mechanism: a forbidden character inside quotes is still forbidden, because
 * the goal is a command that could not have been a shell injection in the
 * first place, not one that has been made safe after the fact.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const char of input) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || current !== '') {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }

  if (quote !== null) {
    throw new CommandError('unbalanced quote in command');
  }
  if (started || current !== '') tokens.push(current);
  return tokens;
}

export function parseCommand(input: string, allowedCommands: readonly string[]): ParsedCommand {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new CommandError('command is empty');
  }
  if (trimmed.length > 512) {
    throw new CommandError('command is longer than 512 characters');
  }

  const forbidden = FORBIDDEN.exec(trimmed);
  if (forbidden) {
    throw new CommandError(
      `command contains the shell metacharacter ${JSON.stringify(forbidden[0])}. ` +
        'PRProof runs commands without a shell, so pipelines, redirection and chaining are not supported. ' +
        'Configure one command per check, or call a script that does the composition.',
    );
  }

  const tokens = tokenize(trimmed);
  const file = tokens[0];
  if (file === undefined || file === '') {
    throw new CommandError('command is empty');
  }

  if (!allowedCommands.includes(file)) {
    throw new CommandError(
      `"${file}" is not in run.allowed_commands. ` +
        'Add it to .prproof.yml on the base branch if this is intentional.',
    );
  }

  return { file, args: tokens.slice(1), display: [file, ...tokens.slice(1)].join(' ') };
}

/**
 * Workflow events whose jobs run with the base repository's token and secrets.
 * PRProof will not execute repository commands in any of them.
 */
export const PRIVILEGED_EVENTS: readonly string[] = [
  'pull_request_target',
  'workflow_run',
  'workflow_dispatch',
  'schedule',
  'repository_dispatch',
  'issue_comment',
];

export function assertSafeExecutionContext(eventName: string | undefined): void {
  if (eventName !== undefined && PRIVILEGED_EVENTS.includes(eventName)) {
    throw new CommandError(
      `refusing to run repository commands during a "${eventName}" event. ` +
        'That context has access to secrets and a write-capable token, so running code from a ' +
        'pull request there would be a privilege escalation. Use mode: checks, or run the ' +
        'analysis from a pull_request workflow. See docs/security.md.',
    );
  }
}

/**
 * Keeps the working directory inside the workspace.
 *
 * `working_directory: ../../` would otherwise let a configuration reach into
 * runner state that has nothing to do with the repository.
 */
export function resolveWorkingDirectory(workspace: string, configured: string): string {
  const root = path.resolve(workspace);
  const target = path.resolve(root, configured);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new CommandError(`run.working_directory must stay inside the workspace (got "${configured}")`);
  }
  return target;
}

/**
 * Environment variables that must never reach a subprocess.
 *
 * A deny-list rather than an allow-list: build tools legitimately read dozens
 * of variables, and breaking every build to guard a job that (by design) has no
 * secrets in it would trade a real cost for a theoretical gain. This is
 * defence in depth behind the "never run in a privileged context" rule.
 */
export const SECRET_ENV_PATTERN =
  /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_KEY|APIKEY|AUTH|COOKIE|SESSION|PRIVATE)/i;

export function scrubEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (key.startsWith('INPUT_')) continue;
    if (key.startsWith('ACTIONS_')) continue;
    if (SECRET_ENV_PATTERN.test(key)) continue;
    scrubbed[key] = value;
  }
  scrubbed['CI'] = 'true';
  scrubbed['PRPROOF'] = '1';
  return scrubbed;
}

export interface RunOptions {
  readonly cwd: string;
  readonly timeoutSeconds: number;
  readonly env?: NodeJS.ProcessEnv;
  /** Number of output lines kept for the report. */
  readonly tailLines?: number;
}

export interface RunResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** Last lines of combined output, redacted and truncated. */
  readonly outputTail: readonly string[];
}

const MAX_CAPTURED_BYTES = 256 * 1024;
const MAX_LINE_LENGTH = 200;
const DEFAULT_TAIL_LINES = 15;

/** Runs a parsed command with no shell, a hard timeout and bounded output. */
export async function runCommand(command: ParsedCommand, options: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const tailLines = options.tailLines ?? DEFAULT_TAIL_LINES;

  return new Promise<RunResult>((resolve) => {
    const child = spawn(command.file, [...command.args], {
      cwd: options.cwd,
      env: options.env ?? scrubEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let captured = '';
    let capturedBytes = 0;
    let timedOut = false;
    let settled = false;

    const capture = (chunk: Buffer): void => {
      if (capturedBytes >= MAX_CAPTURED_BYTES) return;
      capturedBytes += chunk.length;
      captured += chunk.toString('utf8');
      if (captured.length > MAX_CAPTURED_BYTES) {
        captured = captured.slice(-MAX_CAPTURED_BYTES);
      }
    };

    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // A process that ignores SIGTERM must not hold the workflow open.
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, options.timeoutSeconds * 1_000);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: !timedOut && exitCode === 0,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - started,
        outputTail: tailOf(captured, tailLines),
      });
    };

    child.on('error', (error) => {
      captured += `\n${error.message}`;
      finish(null, null);
    });
    child.on('close', (code, signal) => {
      finish(code, signal);
    });
  });
}

/** Extracts the last non-empty lines, redacted and length-capped. */
export function tailOf(output: string, lines: number): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-lines)
    .map((line) => redactSecrets(line).slice(0, MAX_LINE_LENGTH));
}
