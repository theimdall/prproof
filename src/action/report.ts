import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import * as github from '@actions/github';
import { DefaultArtifactClient } from '@actions/artifact';

import { renderMarkdown } from '../core/render/markdown.js';
import { createGitHubApi } from '../github/api.js';
import { publishCheckRun } from '../github/check-run.js';
import { upsertReportComment } from '../github/comment.js';
import { DEFAULT_ARTIFACT_NAME, parseEnvelope, REPORT_FILENAME, type ReportEnvelope } from './envelope.js';

/**
 * The privileged half of PRProof.
 *
 * This action runs on `workflow_run`, which means it has a write-capable token
 * and access to secrets. It therefore does exactly two things: read a JSON
 * artifact, and write a comment and a check run. It never checks out the head
 * of a pull request, never runs repository code, and never trusts a value from
 * the artifact without checking it against the GitHub API first.
 */

interface WorkflowRunPayload {
  readonly id: number;
  readonly head_sha: string;
  readonly event: string;
  readonly conclusion: string | null;
  readonly head_repository?: { readonly full_name?: string } | undefined;
}

function booleanInput(name: string, fallback: boolean): boolean {
  const raw = core.getInput(name).trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

async function downloadEnvelope(
  token: string,
  owner: string,
  repo: string,
  runId: number,
  artifactName: string,
): Promise<ReportEnvelope | null> {
  const client = new DefaultArtifactClient();
  const findBy = {
    token,
    workflowRunId: runId,
    repositoryOwner: owner,
    repositoryName: repo,
  };

  const found = await client.getArtifact(artifactName, { findBy }).catch(() => null);
  if (!found?.artifact) {
    core.info(`No "${artifactName}" artifact on run ${runId}; nothing to report.`);
    return null;
  }

  const directory = await mkdtemp(path.join(process.env['RUNNER_TEMP'] ?? tmpdir(), 'prproof-report-'));
  await client.downloadArtifact(found.artifact.id, { findBy, path: directory });

  const text = await readFile(path.join(directory, REPORT_FILENAME), 'utf8');
  return parseEnvelope(text);
}

/**
 * Confirms the artifact is describing the pull request it claims to.
 *
 * Without this, a report produced for one pull request could be posted onto
 * another. The head SHA of the workflow run is authoritative — it comes from
 * the event payload, not from the artifact — so the pull request named in the
 * artifact must currently point at that same commit.
 */
async function verifyTarget(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  envelope: ReportEnvelope,
  runHeadSha: string,
): Promise<boolean> {
  if (envelope.owner !== owner || envelope.repo !== repo) {
    core.setFailed(`Report artifact targets ${envelope.owner}/${envelope.repo}, not ${owner}/${repo}.`);
    return false;
  }
  if (envelope.headSha !== runHeadSha) {
    core.setFailed('Report artifact head SHA does not match the workflow run that produced it.');
    return false;
  }

  const pull = await octokit.rest.pulls.get({ owner, repo, pull_number: envelope.pullNumber });
  if (pull.data.head.sha !== runHeadSha) {
    core.setFailed(
      `Pull request #${envelope.pullNumber} is at ${pull.data.head.sha.slice(0, 7)}, ` +
        `but the report was produced for ${runHeadSha.slice(0, 7)}. Refusing to post a stale report.`,
    );
    return false;
  }
  return true;
}

export async function main(): Promise<void> {
  const context = github.context;
  const workflowRun = context.payload['workflow_run'] as WorkflowRunPayload | undefined;

  if (!workflowRun) {
    core.setFailed('This action must be triggered by a workflow_run event.');
    return;
  }
  if (workflowRun.event !== 'pull_request') {
    core.info(`Triggering run was a "${workflowRun.event}" event, not a pull request. Nothing to do.`);
    return;
  }

  const token = core.getInput('token', { required: true });
  const artifactName = core.getInput('artifact-name') || DEFAULT_ARTIFACT_NAME;
  const { owner, repo } = context.repo;

  const envelope = await downloadEnvelope(token, owner, repo, workflowRun.id, artifactName);
  if (!envelope) return;

  const octokit = github.getOctokit(token);
  const api = createGitHubApi(octokit, owner, repo);

  if (!(await verifyTarget(octokit, owner, repo, envelope, workflowRun.head_sha))) return;

  // Re-rendered here, in the privileged job, from validated data. The analysis
  // job never gets to choose the markup that ends up in the comment.
  const markdown = renderMarkdown(envelope.report);

  if (booleanInput('comment', true)) {
    const result = await upsertReportComment(api, envelope.pullNumber, markdown);
    core.info(result.message);
  }

  if (booleanInput('check-run', true)) {
    const result = await publishCheckRun(api, envelope.report);
    core.info(result.message);
  }

  core.setOutput('score', String(envelope.report.score.score));
  core.setOutput('band', envelope.report.score.band);
  core.setOutput('failed', String(envelope.report.failed));
}

export async function runAction(): Promise<void> {
  try {
    await main();
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

// Not a top-level await: the action bundle is CommonJS, and runAction()
// handles its own failures through core.setFailed.
void runAction();
