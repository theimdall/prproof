<div align="center">

# PRProof

**Evidence before merge.**

PRProof answers one question before a human opens the diff:
**is this pull request ready to be reviewed?**

[![CI](https://github.com/theimdall/prproof/actions/workflows/ci.yml/badge.svg)](https://github.com/theimdall/prproof/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.10-brightgreen.svg)](package.json)

</div>

---

## The problem

Most of the effort in code review is spent on things nobody needed to read code to find out.

The build is red. There are no tests. It is 34 files. The description is empty. Someone else
opened the same pull request last week. Every one of those is discoverable _before_ a reviewer
starts, and today every one of them is discovered by a human, one pull request at a time,
scattered across four different parts of the GitHub UI.

PRProof collects that evidence and puts it in one comment.

```
## PRProof Report

### 85 / 100 — GOOD

| Check        | Result       | Detail                                          |
| ------------ | ------------ | ----------------------------------------------- |
| Build        | ✅ Passed    | Reported by the workflow as "success".          |
| Tests        | ✅ Passed    | Reported by the workflow as "success".          |
| Lint         | ✅ Passed    | Reported by the workflow as "success".          |
| PR size      | ✅ Passed    | 2 files, +91 / -12 lines.                       |
| Test changes | ⚠️ Warning   | 2 source files changed and no test file did.    |
| Dependencies | ✅ Passed    | No manifest or lock file changed.               |
| Duplicate PR | ✅ Passed    | Compared against 7 open pull requests.          |
| Description  | ✅ Passed    | 168 meaningful characters.                      |
```

Real reports for ten different kinds of pull request live in
[docs/examples](docs/examples) — they are generated from the test fixtures, so they are
always exactly what the current code produces.

## What PRProof is, and is not

**It is** a deterministic triage gate. Same input, same output, every time. No LLM, no API key,
no external service beyond GitHub itself. Every point it deducts is traceable to a rule id, and
the arithmetic is printed in the comment.

**It is not** a code reviewer. It does not read your logic, judge your design, or find bugs.
CodeQL, your linter and your colleagues do that. PRProof only tells you whether it is worth
their time yet.

## Quick start

Add one workflow. This is the complete, recommended setup:

```yaml
# .github/workflows/prproof.yml
name: PRProof

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  prproof:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - run: npm ci
      - id: build
        run: npm run build
        continue-on-error: true
      - id: test
        run: npm test
        continue-on-error: true

      - uses: theimdall/prproof@v0.2.0
        with:
          build-result: ${{ steps.build.outcome }}
          test-result: ${{ steps.test.outcome }}
```

Pin to a released tag, as above, or to a commit SHA. A floating `@v1` tag will exist from
the 1.0 release.

No configuration file is required. Without one, PRProof uses defaults that are documented in
[docs/configuration.md](docs/configuration.md).

> **Pull requests from forks.** GitHub makes `GITHUB_TOKEN` read-only for them, so the comment
> cannot be posted from this workflow. PRProof detects that, writes the report to the job
> summary instead, and never fails on it. To get comments on fork pull requests as well, add
> the second workflow described in [docs/fork-pull-requests.md](docs/fork-pull-requests.md).

## Who runs the build?

This is the one design decision worth understanding before adopting PRProof.

### `mode: checks` — the default

PRProof runs **no commands at all**. It reads results that already exist: the outcome of steps
in your workflow (as above), or check runs published for the head commit.

```yaml
- uses: theimdall/prproof@v0.2.0
  with:
    build-result: ${{ steps.build.outcome }}
    test-result: ${{ steps.test.outcome }}
```

Or, without touching your existing jobs, by check run name:

```yaml
# .prproof.yml
test:
  check_name: unit tests # a check that some other workflow already publishes
```

This is the default because it is both faster (your CI already ran the build; PRProof does not
run it twice) and safer (PRProof is not a code execution surface at all).

### `mode: run` — opt-in

PRProof executes the commands from `.prproof.yml` itself:

```yaml
# .prproof.yml
mode: run
build:
  command: npm run build
test:
  command: npm test
```

Convenient — but it means PRProof starts processes on behalf of a pull request, so it is
hardened: no shell, an executable allowlist, configuration read from the base branch, and a
hard refusal to run in any privileged workflow context. The details, and the reasoning, are in
[docs/security.md](docs/security.md).

## Rules

| ID         | Rule                  | Severity       | What it means                                                                  |
| ---------- | --------------------- | -------------- | ------------------------------------------------------------------------------ |
| `BUILD001` | Build failed          | CRITICAL       | The build did not succeed for the head commit.                                 |
| `TEST001`  | Tests failed          | CRITICAL       | The test suite did not succeed.                                                |
| `LINT001`  | Lint failed           | HIGH           | The linter did not succeed.                                                    |
| `TEST002`  | No test files changed | WARNING        | Source changed; no test did. Skipped for docs-only work.                       |
| `PR001`    | Large pull request    | WARNING        | Past the configured file or line limit. Penalty scales with the overshoot.     |
| `PR002`    | Weak description      | WARNING        | Empty, or shorter than the configured minimum. Template comments do not count. |
| `PR003`    | No linked issue       | INFO           | Only when `require_issue_reference` is on.                                     |
| `DEP001`   | Dependency change     | WARNING / INFO | A new dependency, a lock-only change, or a manifest that could not be read.    |
| `DUP001`   | Possible duplicate    | WARNING        | Another open pull request shares an issue or most of the same files.           |
| `DOC001`   | Documentation-only    | INFO           | Modifier: lets build, test and test-change rules stand down.                   |

Every rule reports one of four outcomes: **passed**, **failed**, **skipped** or **unknown**.
Only _failed_ costs points. A check PRProof could not observe is reported as unknown and never
scored — a quality gate that shows green for a check that never ran is worse than no gate.

Full descriptions: [docs/rules.md](docs/rules.md).

## Scoring

Start at 100 and subtract. Then apply two ceilings.

```text
  100  base
  -40  TEST001   Tests failed
  ---
   60  subtotal
   45  capped at 45 because a critical check failed
   45  HIGH RISK
```

Three properties make the number mean something:

1. **A critical failure caps the score at 45.** A pull request with a broken build is not a
   good pull request, however tidy the rest of it is. Subtraction alone would land it at 60 and
   call it "REVIEW REQUIRED", which reads as _mediocre_ rather than _not ready_.
2. **A high severity failure caps it at 74.** At best "REVIEW REQUIRED".
3. **Warnings share a budget of 35 points.** Style-level findings alone can never push a pull
   request into HIGH RISK, so that band keeps its meaning.

| Score  | Band            |
| ------ | --------------- |
| 90–100 | EXCELLENT       |
| 75–89  | GOOD            |
| 50–74  | REVIEW REQUIRED |
| 0–49   | HIGH RISK       |

Weights are configurable; the ceilings are not, so scores stay comparable between repositories.
The full model, with worked examples: [docs/scoring.md](docs/scoring.md).

## Blocking, or not

By default PRProof fails the workflow step only on a critical rule:

```yaml
# .prproof.yml
fail_on: [critical] # [] to never block, [critical, high] to be stricter
```

Everything else is advice. A quality gate that blocks on advice gets switched off within a
month.

## Configuration

`.prproof.yml`, in the repository root, entirely optional:

```yaml
version: 1

mode: checks # checks (default) | run

build:
  command: npm run build # used in run mode
  check_name: build # used in checks mode
  required: true
test:
  command: npm test
  required: true
lint:
  command: npm run lint
  required: false

limits:
  max_changed_files: 20
  max_changed_lines: 1000

tests:
  require_test_changes: true

pull_request:
  minimum_description_length: 50
  require_issue_reference: false
  skip_drafts: true

dependencies:
  warn_on_change: true

duplicate_detection:
  enabled: true

fail_on: [critical]
```

Unknown keys are an error, not a warning: a typo that silently disables a rule is worse than a
failed run. Every option: [docs/configuration.md](docs/configuration.md).

## CLI

Check a branch before opening the pull request:

```console
$ npx prproof analyze --base main

PRProof

Score: 85 / 100  (GOOD)

PASS  BUILD001  Build passed
PASS  TEST001   Tests passed
WARN  TEST002   No test files changed
PASS  DEP001    No dependency changes
PASS  PR001     Pull request size is within limits

Score breakdown
   100  base
   -15  TEST002   No test files changed

Result: GOOD
```

```console
$ prproof analyze --run          # execute the configured commands locally
$ prproof analyze --format json  # machine-readable, same schema as the artifact
$ prproof rules                  # list every rule and its severity
```

Rules that need GitHub data (description, linked issue, duplicates) report as _skipped_ in
local mode rather than guessing. Details: [docs/cli.md](docs/cli.md).

## Architecture

```text
src/
├─ core/          pure: no network, no subprocesses, no file system, no Actions toolkit
│  ├─ config/     .prproof.yml parsing and validation
│  ├─ model/      the types every layer agrees on
│  ├─ analysis/   diff classification, dependency parsing, duplicate scoring
│  ├─ rules/      one file per rule
│  ├─ scoring/    penalties and ceilings
│  ├─ engine/     orchestration and error isolation
│  └─ render/     markdown, terminal, JSON, sanitisation
├─ adapters/      git, command execution, check resolution
├─ github/        Octokit: files, comments, check runs
├─ cli/           prproof analyze
└─ action/        analyze (unprivileged) and report (privileged)
```

`core/` never imports `@actions/*`, Octokit, `node:fs` or `node:child_process`, and a test
enforces it rather than a comment asking politely. That is what keeps a future GitHub App or
GitLab port from being a rewrite.

## Security model

PRProof runs inside CI, reads a contributor's pull request, and writes to your repository. That
combination deserves care, so the design starts from what must never happen:

- **Configuration is read from the base branch.** A pull request cannot change the rules it is
  judged by — or, in `run` mode, the commands that get executed.
- **No shell, ever.** Commands are parsed into `argv` and spawned with `shell: false`. Shell
  metacharacters are a configuration error, not something to escape.
- **Execution is refused in privileged contexts.** `pull_request_target`, `workflow_run` and
  friends have secrets and a write token; PRProof will not start a process there.
- **The privileged reporting job never checks out pull request code.** It reads a JSON
  artifact, re-validates every field, and re-renders the comment itself.
- **Untrusted text is sanitised.** HTML comments stripped (so nothing can forge PRProof's own
  marker), angle brackets escaped, mentions and issue references defused, output redacted.
- **Least privilege.** `contents: read` to analyse; `pull-requests: write` and `checks: write`
  only in the job that reports.

What PRProof does **not** claim: it cannot protect a repository whose workflow already leaks
secrets to untrusted code, and `mode: run` is a smaller risk than `pull_request_target`, not a
zero one. [docs/security.md](docs/security.md) says exactly where the boundaries are.

## Roadmap

**v0.2** — coverage deltas, CODEOWNERS awareness, conventional commits, monorepo path scoping,
better duplicate detection.

**v0.3** — an _optional_ AI layer, bring-your-own provider, for the questions rules cannot
answer ("does this change do what the description claims?"). PRProof stays fully usable without
it, forever.

**v0.4** — a GitHub App, so a repository can adopt PRProof without adding a workflow file.

## Contributing

New rules are the most welcome contribution, and there is a
[template issue](.github/ISSUE_TEMPLATE/new_rule.yml) for proposing one. The bar: deterministic,
explainable, and low enough in false positives that a maintainer will not switch it off.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).
