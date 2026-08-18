# Rules

Every rule is independent, pure, and returns one of four outcomes:

| Outcome     | Meaning                               | Costs points |
| ----------- | ------------------------------------- | ------------ |
| **passed**  | The rule ran and found nothing.       | no           |
| **failed**  | The rule ran and found something.     | yes          |
| **skipped** | The rule did not apply, and says why. | no           |
| **unknown** | The rule could not run, and says why. | no           |

The distinction between _passed_ and _skipped_/_unknown_ is not cosmetic. A gate that shows a
green tick for a check that never executed teaches people to ignore green ticks.

---

## BUILD001 — Build

**Severity:** CRITICAL (HIGH when `required: false`)

Fails when the build did not succeed for the head commit. The verdict comes from, in order of
precedence:

1. the `build-result` action input (e.g. `${{ steps.build.outcome }}`),
2. a check run named by `build.check_name`,
3. `build.command`, executed by PRProof — only in `mode: run`.

Skipped when nothing is configured, and when the pull request is documentation-only (see
`documentation_only.skip`).

```yaml
build:
  command: npm run build # mode: run
  check_name: build # mode: checks
  required: true
```

## TEST001 — Tests

**Severity:** CRITICAL (HIGH when `required: false`)

Identical mechanism to `BUILD001`, for the test suite. PRProof deliberately does not parse test
output: exit code zero or not, plus a short redacted tail of the output. The full log is in the
Actions run, and copying it into a comment helps nobody.

## LINT001 — Lint

**Severity:** HIGH (WARNING when `required: false`)

Identical mechanism again. `required: false` by default, because a lint failure is rarely a
reason to stop a review.

> Build, tests and lint share one implementation
> ([`src/core/rules/checks.ts`](../src/core/rules/checks.ts)). Adding a fourth check — a type
> check, a security scan — is a five-line change, not a fourth copy of the same logic.

## TEST002 — Test changes

**Severity:** WARNING · **Weight:** 15

Fails when source files changed and no test file did.

What counts as _source_ is an explicit list of code extensions (`.ts`, `.py`, `.go`, `.rs`,
`.java`, …). Workflow YAML, Dockerfiles and `.gitignore` are deliberately excluded — demanding
a unit test for a CI tweak is the fastest way to get a quality gate switched off.

What counts as a _test_ is configurable:

```yaml
tests:
  require_test_changes: true
  patterns:
    - '**/test/**'
    - '**/*.test.*'
    - '**/*_test.go'
    - '**/test_*.py'
```

Skipped when: the pull request is documentation-only, no source changed, the diff was truncated,
or the check is turned off.

## PR001 — Pull request size

**Severity:** WARNING · **Weight:** 12, scaled

Fails past `limits.max_changed_files` or `limits.max_changed_lines`. The penalty scales with the
overshoot — see [scoring.md](scoring.md#pr001-scales-with-the-overshoot).

```yaml
limits:
  max_changed_files: 20
  max_changed_lines: 1000
  exclude:
    - '**/package-lock.json' # lock files are excluded by default
    - 'dist/**' # add your own generated output
```

Files matching `limits.exclude` do not count towards the size, and `TEST002` does not expect
tests for them. Lock files are excluded by default: a dependency bump that rewrites four
thousand lines of `package-lock.json` is not a large pull request, and treating it as one is the
fastest way to teach people to ignore this rule. A repository that commits a build artefact — as
PRProof itself must, because GitHub Actions runs actions from a bundle — should add it here.

If GitHub truncated the file list (it stops at 3000), the report says so: the real change is
larger than what was measured.

## PR002 — Description

**Severity:** WARNING · **Weight:** 12

Fails when the description is shorter than `pull_request.minimum_description_length`.

Length is measured _after_ removing HTML comments, headings, checklist markers, links and code
blocks — otherwise an untouched pull request template would pass as a description, which is
exactly the case worth catching.

Skipped in local CLI mode, where there is no description to read.

## PR003 — Linked issue

**Severity:** INFO · **Weight:** 4

Only evaluated when `pull_request.require_issue_reference: true`; skipped otherwise.

References are read from the title and body: `#123`, `GH-123`, and full issue URLs. Text inside
code fences and backticks is ignored, so `#123` in a snippet is not mistaken for a reference.
Links to _pull requests_ do not count.

## DEP001 — Dependencies

**Severity:** WARNING (INFO for weaker signals) · **Weight:** 3

Three outcomes, in descending confidence:

| Situation                                  | Severity | Report                              |
| ------------------------------------------ | -------- | ----------------------------------- |
| A manifest diff added a dependency         | WARNING  | names, versions, and which manifest |
| Only a lock file changed                   | INFO     | "usually a transitive update"       |
| A manifest changed but could not be parsed | INFO     | "could not determine what changed"  |

PRProof fetches **both versions** of every changed manifest (up to ten) and compares them.
A unified diff carries three lines of context, and in a dependency list of any size the
`"dependencies": {` header sits far above the changed line — so patch parsing alone misses most
real additions. When a manifest cannot be fetched, PRProof falls back to the patch and, if that
reading is not confident, reports _unknown_ rather than _none_.

Manifests are recognised by name, and no checkout is needed: `package.json`,
`composer.json`, `requirements*.txt`, `pyproject.toml`, `Pipfile`, `go.mod`, `Cargo.toml`,
`build.gradle[.kts]`, `*.csproj`, `Gemfile`, `pubspec.yaml`. Lock files are recorded as changed
but never mined — their diffs are enormous and derived from the manifest anyway.

A dependency change is **not** treated as a defect. It is a decision a reviewer should make
consciously, and it is easy to miss inside a large diff. If PRProof cannot read a manifest, it
says _unknown_ — never "no new dependencies".

## DUP001 — Possible duplicate pull request

**Severity:** WARNING · **Weight:** 12

Fails when another open pull request looks like the same work. Two deterministic signals:

1. **Shared linked issue.** Both reference the same issue number.
2. **File overlap.** At least `min_shared_files` files in common _and_ a Jaccard similarity of
   the two changed-file sets of at least `min_similarity`.

```yaml
duplicate_detection:
  enabled: true
  max_open_pull_requests: 50 # how many are listed
  max_compared_pull_requests: 10 # how many have their file lists fetched
  min_shared_files: 3
  min_similarity: 0.6
```

Guards against false positives, in order of how much they matter:

- **No title similarity.** "Fix typo", "Update deps" and "Bump version" are near-identical
  strings on completely unrelated work.
- **Noisy files excluded** from the comparison: lock files, `CHANGELOG`, `README`, snapshots,
  `.gitignore`. Everyone touches them.
- **Stacked branches ignored.** If one pull request's base is the other's head, the overlap is
  by construction, not duplication.
- **Unknown is not "no overlap".** If a file list could not be fetched completely, that pull
  request is not compared rather than compared badly.
- Skipped entirely when the diff was truncated, or when open pull requests could not be listed.

This is the rule most likely to be wrong. It is a WARNING, it never blocks, and it can be
switched off in one line.

## DOC001 — Documentation-only

**Severity:** INFO · **Weight:** 0

Not a gate — a modifier. It passes when _every_ changed file is documentation, and that is what
allows `BUILD001`, `TEST001` and `TEST002` to stand down:

```yaml
documentation_only:
  patterns: ['**/*.md', 'docs/**', 'README*', 'LICENSE*']
  skip: [build, test]
```

Files are classified with a fixed precedence — lock files, then dependency manifests, then
documentation, then tests, then source — so `requirements.txt` stays a manifest even though the
documentation patterns are broad, and `tests/README.md` does not count as a test change.

---

## Proposing a rule

A rule is a good fit when it is:

- **deterministic** — same input, same output, no network,
- **explainable** — a maintainer can see why it fired,
- **low false positive** — or it will be switched off, taking the useful rules with it,
- **not a linter's job** — PRProof works at pull-request level, not line level.

There is an issue template: [New rule proposal](../.github/ISSUE_TEMPLATE/new_rule.yml).
