import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import * as github from '@actions/github';
import { DefaultArtifactClient } from '@actions/artifact';

import { resolveChecks, type CheckRunSummary } from '../adapters/checks/resolve.js';
import { collectManifestSnapshots } from '../adapters/diff/manifests.js';
import { CHECK_KINDS, DEFAULT_CONFIG, type CheckKind, type Config } from '../core/config/schema.js';
import { parseConfigText } from '../core/config/load.js';
import { ConfigError } from '../core/config/validate.js';
import { analyse } from '../core/engine/engine.js';
import { buildContext } from '../core/engine/build-context.js';
import { renderMarkdown } from '../core/render/markdown.js';
import { createGitHubApi, type ApiPullRequest, type GitHubApi } from '../github/api.js';
import { publishCheckRun } from '../github/check-run.js';
import { upsertReportComment } from '../github/comment.js';
import {
  collectOpenPullRequests,
  MAX_PULL_REQUEST_FILES,
  toDiffSummary,
  toPullRequestInfo,
} from '../github/pull-request.js';
import {
  DEFAULT_ARTIFACT_NAME,
  ENVELOPE_VERSION,
  REPORT_FILENAME,
  serialiseEnvelope,
  type ReportEnvelope,
} from './envelope.js';

function booleanInput(name: string, fallback: boolean): boolean {
  const raw = core.getInput(name).trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function optionalInput(name: string): string | undefined {
  const raw = core.getInput(name).trim();
  return raw === '' ? undefined : raw;
}

/**
 * Loads configuration, preferring the base branch.
 *
 * This is the single most important line of defence in the whole action: a
 * pull request must not be able to rewrite the rules it is judged by, and in
 * `run` mode it must not be able to choose the commands that get executed.
 */
async function loadConfiguration(
  api: GitHubApi,
  pull: ApiPullRequest,
  configPath: string,
  source: 'base' | 'head',
  changedPaths: readonly string[],
  notes: string[],
): Promise<Config> {
  if (source === 'head') {
    notes.push(
      'Configuration was read from the pull request head (`config-source: head`). ' +
        'A contributor can change the rules their own pull request is judged by.',
    );
    core.warning(
      'config-source: head means the pull request controls its own quality gate. ' +
        'Use the default (base) unless every contributor already has write access.',
    );
    const workspace = process.env['GITHUB_WORKSPACE'] ?? process.cwd();
    try {
      const text = await readFile(path.join(workspace, configPath), 'utf8');
      return parseConfigText(text, configPath);
    } catch {
      notes.push(`No ${configPath} found in the pull request; built-in defaults were used.`);
      return DEFAULT_CONFIG;
    }
  }

  const ref = pull.base.sha ?? pull.base.ref;
  const text = await api.getFileContent(configPath, ref);
  if (text === null) {
    notes.push(`No ${configPath} on the base branch; built-in defaults were used.`);
    return DEFAULT_CONFIG;
  }

  if (changedPaths.includes(configPath)) {
    notes.push(
      `This pull request modifies ${configPath}. The version from the base branch was used for this report.`,
    );
  }
  return parseConfigText(text, configPath);
}

function applyInputOverrides(config: Config, notes: string[]): Config {
  let result = config;

  const mode = optionalInput('mode');
  if (mode === 'checks' || mode === 'run') {
    result = { ...result, mode };
  } else if (mode !== undefined) {
    core.warning(`Ignoring unknown mode input "${mode}".`);
  }

  const failOn = optionalInput('fail-on');
  if (failOn !== undefined) {
    const severities = failOn
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== '' && entry !== 'none');
    result = { ...result, failOn: severities as Config['failOn'] };
  }

  if (result.mode === 'run') {
    notes.push('Build, test and lint commands were executed by PRProof (`mode: run`).');
  }
  return result;
}

function readStepOutcomes(): Partial<Record<CheckKind, string | undefined>> {
  const inputs: Partial<Record<CheckKind, string | undefined>> = {};
  for (const kind of CHECK_KINDS) {
    const value = optionalInput(`${kind}-result`);
    if (value !== undefined) inputs[kind] = value;
  }
  return inputs;
}

async function writeReportArtifact(envelope: ReportEnvelope, artifactName: string): Promise<string> {
  // Written outside the workspace on purpose: in `run` mode repository code has
  // already executed, and the workspace is not a place to keep evidence.
  const directory = await mkdtemp(path.join(process.env['RUNNER_TEMP'] ?? tmpdir(), 'prproof-'));
  const file = path.join(directory, REPORT_FILENAME);
  await writeFile(file, serialiseEnvelope(envelope), 'utf8');

  try {
    const client = new DefaultArtifactClient();
    await client.uploadArtifact(artifactName, [file], directory, { retentionDays: 1 });
    core.info(`Uploaded the report as artifact "${artifactName}".`);
  } catch (error) {
    core.warning(
      `Could not upload the report artifact: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return file;
}

export async function main(): Promise<void> {
  const context = github.context;
  const payloadPull = context.payload['pull_request'] as ApiPullRequest | undefined;

  if (!payloadPull) {
    core.info('No pull request in the event payload; PRProof has nothing to analyse.');
    return;
  }

  const token = core.getInput('token', { required: true });
  const configPath = core.getInput('config-path') || '.prproof.yml';
  const configSource = core.getInput('config-source') === 'head' ? 'head' : 'base';
  const artifactName = core.getInput('artifact-name') || DEFAULT_ARTIFACT_NAME;

  const octokit = github.getOctokit(token);
  const api = createGitHubApi(octokit, context.repo.owner, context.repo.repo);

  const notes: string[] = [];

  const files = await api.listPullRequestFiles(payloadPull.number, MAX_PULL_REQUEST_FILES);
  if (files.truncated) {
    notes.push(
      `Only the first ${MAX_PULL_REQUEST_FILES} changed files were analysed; the GitHub API does not return more.`,
    );
  }
  const diff = toDiffSummary(files.files, files.truncated);

  const config = applyInputOverrides(
    await loadConfiguration(
      api,
      payloadPull,
      configPath,
      configSource,
      diff.files.map((file) => file.path),
      notes,
    ),
    notes,
  );

  const pullRequest = toPullRequestInfo(payloadPull);

  if (pullRequest.draft && config.pullRequest.skipDrafts) {
    core.info('This pull request is a draft; PRProof is configured to skip drafts.');
    core.setOutput('skipped', 'true');
    return;
  }

  const needsCheckRuns = CHECK_KINDS.some((kind) => config.checks[kind].checkName !== null);
  let checkRuns: CheckRunSummary[] | null = null;
  if (config.mode === 'checks' && needsCheckRuns) {
    try {
      checkRuns = await api.listCheckRuns(pullRequest.headSha);
    } catch (error) {
      notes.push(`Could not read check runs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const checks = await resolveChecks({
    config,
    inputs: readStepOutcomes(),
    checkRuns,
    execution:
      config.mode === 'run'
        ? {
            workspace: process.env['GITHUB_WORKSPACE'] ?? process.cwd(),
            eventName: context.eventName,
          }
        : null,
    notes,
  });

  let collected: Awaited<ReturnType<typeof collectOpenPullRequests>> = {
    pullRequests: [],
    available: false,
    notes: [],
  };
  if (config.duplicateDetection.enabled) {
    collected = await collectOpenPullRequests(api, config.duplicateDetection, {
      number: pullRequest.number,
      linkedIssues: pullRequest.linkedIssues,
    });
    notes.push(...collected.notes);
  }

  // Both versions of every changed manifest, so DEP001 can compare them
  // properly instead of guessing from three lines of diff context.
  const manifestSnapshots = await collectManifestSnapshots(diff.files, config, (path, ref) =>
    api
      .getFileContent(
        path,
        ref === 'base' ? (payloadPull.base.sha ?? payloadPull.base.ref) : pullRequest.headSha,
      )
      .catch(() => null),
  );

  const analysisContext = buildContext({
    config,
    pullRequest,
    diff,
    checks,
    openPullRequests: collected.pullRequests,
    openPullRequestsAvailable: collected.available,
    manifestSnapshots,
    notes,
  });

  const report = analyse(analysisContext);
  const markdown = renderMarkdown(report);

  await core.summary.addRaw(markdown).write();

  if (booleanInput('upload-report', true)) {
    const envelope: ReportEnvelope = {
      version: ENVELOPE_VERSION,
      owner: context.repo.owner,
      repo: context.repo.repo,
      pullNumber: payloadPull.number,
      headSha: pullRequest.headSha,
      report,
    };
    const file = await writeReportArtifact(envelope, artifactName);
    core.setOutput('report-path', file);
  }

  if (booleanInput('comment', config.comment)) {
    const result = await upsertReportComment(api, payloadPull.number, markdown);
    if (result.action === 'forbidden') core.notice(result.message);
    else core.info(result.message);
  }

  if (booleanInput('check-run', config.checkRun)) {
    const result = await publishCheckRun(api, report);
    if (result.action === 'forbidden') core.notice(result.message);
    else core.info(result.message);
  }

  core.setOutput('score', String(report.score.score));
  core.setOutput('band', report.score.band);
  core.setOutput('failed', String(report.failed));

  if (report.failed) {
    core.setFailed(report.failReason ?? 'PRProof found a blocking problem.');
  }
}

export async function runAction(): Promise<void> {
  try {
    await main();
  } catch (error) {
    if (error instanceof ConfigError) {
      core.setFailed(error.message);
      return;
    }
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

await runAction();
