# Configuration

`.prproof.yml` in the repository root. Entirely optional — every key has a default, and PRProof
works with no configuration file at all.

Two properties are worth knowing before anything else:

- **Unknown keys are an error.** A typo silently disabling a rule is worse than a failed run, so
  `require_tests:` (instead of `require_test_changes:`) fails with a message naming the valid
  options.
- **The file is read from the base branch.** A pull request cannot change the rules it is judged
  by. See [security.md](security.md#2-configuration-comes-from-the-base-branch).

## Complete example

Everything below is a default value, so this file is equivalent to having no file at all:

```yaml
version: 1

mode: checks

build:
  command: null
  check_name: null
  required: true
test:
  command: null
  check_name: null
  required: true
lint:
  command: null
  check_name: null
  required: false

limits:
  max_changed_files: 20
  max_changed_lines: 1000
  exclude: # lock files, by default
    - '**/package-lock.json'
    - '**/pnpm-lock.yaml'
    - '**/yarn.lock'
    - '**/go.sum'
    - '**/Cargo.lock'

tests:
  require_test_changes: true
  patterns:
    - '**/test/**'
    - '**/tests/**'
    - '**/__tests__/**'
    - '**/*.test.*'
    - '**/*.spec.*'
    - '**/test_*.py'
    - '**/*_test.py'
    - '**/*_test.go'

pull_request:
  minimum_description_length: 50
  require_issue_reference: false
  skip_drafts: true

dependencies:
  warn_on_change: true

duplicate_detection:
  enabled: true
  max_open_pull_requests: 50
  max_compared_pull_requests: 10
  min_shared_files: 3
  min_similarity: 0.6

documentation_only:
  patterns: ['**/*.md', 'docs/**', 'README*', 'LICENSE*']
  skip: [build, test]

run:
  timeout_seconds: 600
  working_directory: '.'

scoring:
  warning_budget: 35

fail_on: [critical]
comment: true
check_run: true
```

## Reference

### `mode`

`checks` (default) or `run`. See [Who runs the build?](../README.md#who-runs-the-build) — this
is the decision that shapes the security posture.

### `build` / `test` / `lint`

| Key          | Type           | Meaning                                                                                                             |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `command`    | string or null | Executed in `mode: run`. Refused if it contains shell metacharacters or an executable that is not on the allowlist. |
| `check_name` | string or null | Name of a check run to read in `mode: checks`.                                                                      |
| `required`   | boolean        | A required failure is CRITICAL (HIGH for lint). A non-required one is downgraded and charged half.                  |

Leave all three unset and the corresponding rule reports as _skipped_, with a message saying
what to configure.

### `limits`

`max_changed_files` (1–100 000) and `max_changed_lines` (1–10 000 000). Additions plus deletions.

`exclude` lists files that do not count towards the size and that `TEST002` does not expect
tests for — generated bundles, vendored code, lock files. It defaults to the lock file patterns.
Excluded files keep their identity everywhere else: a lock file is still reported by `DEP001`.

### `tests`

`require_test_changes` turns `TEST002` on or off. `patterns` replaces the default test-file
globs entirely — it is not merged with them, so include everything you want matched.

### `pull_request`

| Key                          | Default | Notes                                                                                |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `minimum_description_length` | 50      | Measured after stripping template comments, headings and code. `0` disables `PR002`. |
| `require_issue_reference`    | false   | Turns `PR003` on.                                                                    |
| `skip_drafts`                | true    | Draft pull requests are not analysed and no comment is posted.                       |

### `dependencies`

`warn_on_change` turns `DEP001` on or off. `manifest_patterns` and `lock_patterns` replace the
built-in lists if you have unusual manifests.

### `duplicate_detection`

See [rules.md](rules.md#dup001--possible-duplicate-pull-request). Raising `min_similarity`
towards 1.0 makes the rule stricter; `enabled: false` removes it.

`max_compared_pull_requests` bounds API calls: pull requests sharing a linked issue are compared
first, then the most recently updated. Anything not compared is reported in the notes, never
silently dropped.

### `documentation_only`

`patterns` defines what counts as documentation. `skip` lists which checks stand down for a
documentation-only pull request — any of `build`, `test`, `lint`.

### `run`

Only used in `mode: run`.

| Key                 | Default               | Notes                                            |
| ------------------- | --------------------- | ------------------------------------------------ |
| `timeout_seconds`   | 600                   | SIGTERM, then SIGKILL five seconds later.        |
| `allowed_commands`  | build-tool front-ends | Replaces the default allowlist. No shells on it. |
| `working_directory` | `.`                   | Must resolve inside the workspace.               |

### `scoring`

```yaml
scoring:
  weights:
    TEST002: 20 # any rule id from docs/rules.md
    DUP001: 5
  warning_budget: 35
```

Weights are 0–100. Rule ids that do not exist are an error. The severity ceilings are not
configurable — see [scoring.md](scoring.md#why-ceilings).

### `fail_on`

Which severities make the workflow step fail: `[]`, `[critical]` (default), `[critical, high]`,
or any subset of `info`, `warning`, `high`, `critical`. Listing a severity implies everything
above it.

### `comment` / `check_run`

Turn the pull request comment or the check run off. Both degrade gracefully on their own when
the token lacks permission, so these exist for preference, not for compatibility.

## Action inputs

Inputs override the file, for the cases where a workflow needs to say something the repository
cannot:

| Input                                          | Default               | Purpose                                                  |
| ---------------------------------------------- | --------------------- | -------------------------------------------------------- |
| `token`                                        | `${{ github.token }}` | Read the pull request; write the comment when permitted. |
| `config-path`                                  | `.prproof.yml`        |                                                          |
| `config-source`                                | `base`                | `head` is unsafe on public repositories.                 |
| `mode`                                         | _(file)_              | `checks` or `run`.                                       |
| `build-result` / `test-result` / `lint-result` | —                     | e.g. `${{ steps.build.outcome }}`.                       |
| `comment` / `check-run`                        | `true`                |                                                          |
| `fail-on`                                      | _(file)_              | Comma-separated, or `none`.                              |
| `upload-report`                                | `true`                | Needed by the fork reporting workflow.                   |
| `artifact-name`                                | `prproof-report`      |                                                          |

Outputs: `score`, `band`, `failed`, `report-path`, `skipped`.

## Validation errors

Every problem is reported at once, with a path:

```text
Invalid PRProof configuration:
  limits.max_changed_files: expected a whole number, got string ("twenty")
  pull_request.minimum_description_length: expected a value between 0 and 10000, got -5
  fail_on[0]: expected one of: info, warning, high, critical
```
