# CLI

The same analysis engine the action runs, against a local branch — so you can see the report
before you open the pull request.

```console
$ npx prproof analyze
$ npx prproof analyze --base main --run
$ npx prproof rules
```

Or install it:

```console
$ npm install --save-dev prproof
```

Before the first npm release, run it from a clone:

```console
$ npm install && npm run build
$ node bin/prproof.js analyze --base main
```

## `prproof analyze`

| Option            | Default           | Meaning                                                                             |
| ----------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `--base <ref>`    | detected          | Base branch. Tries `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`. |
| `--head <ref>`    | `HEAD`            | Revision to analyse.                                                                |
| `--config <path>` | `.prproof.yml`    | Configuration file.                                                                 |
| `--cwd <path>`    | current directory | Repository directory.                                                               |
| `--format <fmt>`  | `text`            | `text`, `json` or `markdown`.                                                       |
| `--run`           | off               | Execute the configured build/test/lint commands locally.                            |
| `--verbose`       | off               | Show skipped rules and per-rule detail.                                             |
| `--no-color`      | —                 | Also honoured via `NO_COLOR`.                                                       |
| `--no-fail`       | —                 | Always exit 0.                                                                      |

The diff is computed from the merge base (`git merge-base <base> HEAD`), which is the same
range GitHub shows in "Files changed" — not everything that landed on `main` since you branched.

### Exit codes

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| 0    | Analysis completed; nothing matching `fail_on` failed.                          |
| 1    | A check matching `fail_on` failed.                                              |
| 2    | PRProof could not run: bad configuration, not a git repository, unknown option. |

Suitable for a pre-push hook:

```sh
#!/bin/sh
npx prproof analyze --base main || {
  echo 'PRProof found something. Use --no-fail to push anyway.'
  exit 1
}
```

## What differs from the action

Some evidence only exists on GitHub. Rather than guess, those rules report **skipped** with a
reason:

| Rule                               | Locally                                            |
| ---------------------------------- | -------------------------------------------------- |
| `PR002` description                | skipped — there is no pull request description yet |
| `PR003` linked issue               | skipped — same                                     |
| `DUP001` duplicates                | skipped — open pull requests cannot be listed      |
| `BUILD001` / `TEST001` / `LINT001` | run only with `--run`, otherwise skipped           |

Everything else — size, test changes, dependencies, documentation-only detection — behaves
exactly as it does in CI, from the same code.

## Output formats

**`--format text`** (default): a compact terminal report with the score breakdown.

```text
PRProof

Score: 85 / 100  (GOOD)

PASS  BUILD001  Build passed
PASS  TEST001   Tests passed
WARN  TEST002   No test files changed
      2 source files changed and no test file did.
PASS  DEP001    No dependency changes
PASS  PR001     Pull request size is within limits

Score breakdown
   100  base
   -15  TEST002   No test files changed

Result: GOOD
```

**`--format markdown`**: byte-identical to what the action posts as a comment. Useful for
previewing, and for pasting into a pull request manually.

**`--format json`**: the full report, the same schema the action uploads as an artifact.

```console
$ prproof analyze --format json | jq '.score.score, .score.band'
85
"GOOD"

$ prproof analyze --format json | jq -r '.results[] | select(.status=="failed") | .id'
TEST002
```

## `prproof rules`

Lists every rule, its severity and what it does — the authoritative version of
[rules.md](rules.md), read from the code.

## Running commands locally

`--run` (or `mode: run` in the config) executes the configured commands. Locally this is your
own configuration on your own machine, so the restrictions are lighter in spirit but identical
in code: no shell, executable allowlist, timeout, output redaction.

```console
$ prproof analyze --run --verbose
```
