# Pull requests from forks

Open-source repositories get most of their pull requests from forks, and that is exactly the
case where posting a comment is hardest. This page explains why, and gives the setup that works.

## Why the comment does not appear

For a pull request opened from a fork, GitHub gives the `pull_request` workflow a **read-only**
`GITHUB_TOKEN`. This is correct and deliberate: untrusted code runs in that job, so it must not
be able to write to your repository.

PRProof does not fight it. When the token cannot comment, it:

- writes the full report to the **job summary**, where it is one click away,
- logs a notice explaining why,
- does **not** fail the job.

For many repositories that is enough. If you want comments on fork pull requests too, keep
reading.

## The safe pattern: two workflows

Split the work in half. The half that touches pull request content has no privileges; the half
that has privileges never touches pull request content.

```text
pull_request  ──▶  analyse (read-only token, no secrets)  ──▶  report.json artifact
                                                                       │
workflow_run  ──▶  report (pull-requests: write, checks: write) ◀───────┘
                   downloads JSON · validates it · posts the comment
```

### 1. Analysis — unprivileged

```yaml
# .github/workflows/prproof.yml
name: PRProof

on:
  pull_request:

permissions:
  contents: read

jobs:
  analyze:
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
          comment: false # this job cannot comment on fork pull requests
          check-run: false
          upload-report: true # hand the report to the privileged job
```

### 2. Reporting — privileged, and code-free

```yaml
# .github/workflows/prproof-report.yml
name: PRProof Report

on:
  workflow_run:
    workflows: [PRProof]
    types: [completed]

permissions:
  pull-requests: write
  checks: write

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: theimdall/prproof/report@v0.2.0
```

Note what is **not** in the second workflow: no `actions/checkout`, no `npm ci`, no repository
code of any kind. It downloads one JSON artifact and writes a comment.

## Why not `pull_request_target`

Because it is the wrong tool, and increasingly a blocked one.

`pull_request_target` runs with the base repository's token and secrets. Checking out the pull
request's head there and running anything from it hands your credentials to whoever opened the
pull request — the _pwn request_ pattern behind several supply-chain compromises. Since
`actions/checkout` v7 (June 2026, backported and enforced from 20 July 2026), checking out a
fork's head or merge ref under `pull_request_target` is refused unless you explicitly pass
`allow-unsafe-pr-checkout`.

The `workflow_run` split above gets you the same comment without ever putting untrusted code and
write credentials in the same job.

## What the reporting job checks before it writes

The artifact is treated as untrusted input, even though PRProof produced it:

1. **Size and schema.** Over 1 MB is rejected; every field is re-validated and re-typed, unknown
   fields are dropped, strings truncated, numbers clamped.
2. **Repository match.** The artifact must name this owner and repository.
3. **Commit match.** Its head SHA must equal the `workflow_run` head SHA, which comes from the
   event payload and cannot be forged by the artifact.
4. **Pull request match.** The API is asked whether the named pull request currently points at
   that same commit. If the branch has moved on, the stale report is refused rather than posted.
5. **Re-rendering.** The markdown is generated in the privileged job from validated data. The
   analysis job never gets to choose what appears in the comment.

## Same-repository pull requests

If your repository does not take fork contributions, the single workflow in the
[README](../README.md#quick-start) is simpler and does the same thing — the token there already
has write access.

## Troubleshooting

**No comment, and the log says the token is read-only.** That is a fork pull request without the
reporting workflow. Add it, or read the job summary.

**No comment, and the reporting job says "No prproof-report artifact".** The analysis workflow
needs `upload-report: true` (the default), and the `workflows:` name in the `workflow_run`
trigger must match the analysis workflow's `name:` exactly.

**"Refusing to post a stale report".** Someone pushed while the analysis was running. The next
run posts the current state.

**The check run is missing but the comment is there.** `checks: write` is missing from the
reporting workflow's `permissions`.
