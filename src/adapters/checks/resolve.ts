import { CHECK_KINDS, type CheckKind, type Config } from '../../core/config/schema.js';
import type { CheckOutcome, CheckStatus } from '../../core/model/context.js';
import {
  assertSafeExecutionContext,
  CommandError,
  parseCommand,
  resolveWorkingDirectory,
  runCommand,
} from '../exec/command.js';

/** A check run as returned by the GitHub Checks API, reduced to what matters. */
export interface CheckRunSummary {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
}

export interface ResolveChecksOptions {
  readonly config: Config;
  /**
   * Outcomes handed in by the workflow, e.g. `${{ steps.build.outcome }}`.
   * These win over everything else: the workflow author observed the step
   * directly, which is better evidence than anything PRProof can infer.
   */
  readonly inputs: Partial<Record<CheckKind, string | undefined>>;
  /** Check runs published for the head commit, or `null` if not fetched. */
  readonly checkRuns: readonly CheckRunSummary[] | null;
  /** Set when command execution is permitted (`mode: run`). */
  readonly execution: { readonly workspace: string; readonly eventName?: string } | null;
  /** Collects non-fatal messages for the report. */
  readonly notes: string[];
}

/** Maps a GitHub Actions step outcome to a check status. */
export function statusFromStepOutcome(outcome: string): CheckStatus {
  switch (outcome.trim().toLowerCase()) {
    case 'success':
      return 'passed';
    case 'failure':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default:
      return 'unknown';
  }
}

/** Maps a check run conclusion to a check status. */
export function statusFromCheckRun(run: CheckRunSummary): CheckStatus {
  if (run.status !== 'completed') return 'unknown';
  switch ((run.conclusion ?? '').toLowerCase()) {
    case 'success':
    case 'neutral':
      return 'passed';
    case 'failure':
    case 'timed_out':
    case 'action_required':
      return 'failed';
    case 'skipped':
    case 'cancelled':
      return 'skipped';
    default:
      return 'unknown';
  }
}

async function resolveOne(kind: CheckKind, options: ResolveChecksOptions): Promise<CheckOutcome> {
  const settings = options.config.checks[kind];
  const required = settings.required;

  const input = options.inputs[kind];
  if (input !== undefined && input.trim() !== '') {
    const status = statusFromStepOutcome(input);
    return {
      kind,
      status,
      source: 'input',
      required,
      detail: `Reported by the workflow as "${input.trim()}".`,
    };
  }

  if (options.config.mode === 'run') {
    return runConfiguredCommand(kind, options);
  }

  if (settings.checkName !== null && options.checkRuns !== null) {
    const match = options.checkRuns.find((run) => run.name === settings.checkName);
    if (!match) {
      return {
        kind,
        status: 'unknown',
        source: 'check-run',
        required,
        detail: `No check run named "${settings.checkName}" was found for the head commit.`,
      };
    }
    return {
      kind,
      status: statusFromCheckRun(match),
      source: 'check-run',
      required,
      detail: `Check run "${match.name}" concluded "${match.conclusion ?? match.status}".`,
    };
  }

  return {
    kind,
    status: 'unknown',
    source: 'not-configured',
    required,
    detail: `No ${kind} result was provided.`,
  };
}

async function runConfiguredCommand(kind: CheckKind, options: ResolveChecksOptions): Promise<CheckOutcome> {
  const settings = options.config.checks[kind];
  const required = settings.required;

  if (settings.command === null) {
    return {
      kind,
      status: 'unknown',
      source: 'not-configured',
      required,
      detail: `No ${kind} command is configured.`,
    };
  }
  if (options.execution === null) {
    return {
      kind,
      status: 'unknown',
      source: 'not-configured',
      required,
      detail: 'Command execution is not available in this context.',
    };
  }

  try {
    assertSafeExecutionContext(options.execution.eventName);
    const command = parseCommand(settings.command, options.config.run.allowedCommands);
    const cwd = resolveWorkingDirectory(options.execution.workspace, options.config.run.workingDirectory);

    const result = await runCommand(command, {
      cwd,
      timeoutSeconds: options.config.run.timeoutSeconds,
    });

    if (result.timedOut) {
      return {
        kind,
        status: 'failed',
        source: 'run',
        required,
        detail: `\`${command.display}\` timed out after ${options.config.run.timeoutSeconds}s.`,
        durationMs: result.durationMs,
        outputTail: result.outputTail,
      };
    }

    return {
      kind,
      status: result.ok ? 'passed' : 'failed',
      source: 'run',
      required,
      detail: `\`${command.display}\` exited with code ${result.exitCode ?? 'null'}.`,
      durationMs: result.durationMs,
      outputTail: result.outputTail,
    };
  } catch (error) {
    if (error instanceof CommandError) {
      // A refused command is a configuration problem, not a failing build.
      // Scoring it as a failure would punish the contributor for it.
      options.notes.push(`${kind}: ${error.message}`);
      return {
        kind,
        status: 'unknown',
        source: 'not-configured',
        required,
        detail: error.message,
      };
    }
    throw error;
  }
}

/** Resolves the build, test and lint outcomes for the current run. */
export async function resolveChecks(options: ResolveChecksOptions): Promise<CheckOutcome[]> {
  const outcomes: CheckOutcome[] = [];
  for (const kind of CHECK_KINDS) {
    outcomes.push(await resolveOne(kind, options));
  }
  return outcomes;
}
