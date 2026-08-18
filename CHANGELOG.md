# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-08-18

### Added

- **`limits.exclude`** — files that do not count towards `PR001` size and that `TEST002` does not
  expect tests for. PRProof flagged its own first pull request as 528,529 lines changed, almost
  all of it the committed action bundle; every repository that ships generated output would hit
  the same thing.

### Changed

- **Lock files no longer count towards pull request size.** A dependency bump that rewrites four
  thousand lines of `package-lock.json` is not a large pull request. Set `limits.exclude: []` to
  restore the previous behaviour.
- A documentation change that also refreshes a lock file is still documentation-only.

Excluded files keep their identity everywhere else: `DEP001` still reports a changed lock file.

## [0.1.1] — 2026-08-18

### Fixed

- **The action could not be loaded at all.** Three input descriptions in `action.yml` contained
  `${{ steps.… }}` expressions. GitHub evaluates expressions anywhere in an action manifest, not
  only in defaults, so every run failed with `Unrecognized named-value: 'steps'` before PRProof
  started. Caught by PRProof analysing its own first pull request.
- **`dist/` could never be verified.** ncc assigns module ids in filesystem-walk order, so
  Windows and Linux produced byte-different bundles from identical source and the CI freshness
  check always failed. The bundle is now built with esbuild, which is reproducible across
  platforms, ships a CommonJS marker and keeps dependency licences in an external file.
- **New dependencies were missed** when the diff hunk did not include the enclosing
  `"dependencies"` header — which is the normal case for a manifest of any size. Both versions
  of every changed manifest are now compared; patch parsing remains a fallback that reports
  _unknown_ rather than _none_ when it cannot be trusted.
- **`comment: false` and `check_run: false` in `.prproof.yml` were ignored**, because the action
  input defaults always won.

### Added

- An integration test for the git adapter against a real repository, and direct tests for the
  JSON renderer, check-run summary, terminal renderer, severity helpers and manifest collector.
  227 tests; 92 % lines and 94 % functions on `src/core` and `src/adapters`.

## [0.1.0] — 2026-08-18

First release.

### Added

- **Ten rules**: `BUILD001`, `TEST001`, `LINT001` (build, tests, lint), `TEST002` (no test
  changes), `PR001` (size), `PR002` (description), `PR003` (linked issue), `DEP001`
  (dependencies), `DUP001` (possible duplicate), `DOC001` (documentation-only modifier).
- **Explainable scoring**: penalties, a warning budget of 35 points, and severity ceilings —
  45 for a critical failure, 74 for a high one — with the arithmetic printed in every report.
- **Two modes**: `checks` (default) reads build, test and lint results that already exist and
  executes nothing; `run` executes configured commands with no shell, an executable allowlist,
  base-branch configuration and a refusal to run in privileged workflow contexts.
- **Sticky pull request comment**: one comment per pull request, updated in place, and skipped
  entirely when the body has not changed.
- **GitHub check run** with `success`, `neutral` or `failure`.
- **Fork-safe reporting**: an unprivileged analysis action plus a privileged `prproof/report`
  action that reads a validated JSON artifact and never checks out pull request code.
- **CLI**: `prproof analyze` with text, markdown and JSON output, and `prproof rules`.
- **Configuration**: `.prproof.yml`, all keys optional, unknown keys rejected, YAML anchors
  refused.
- **Documentation**: rules, scoring, configuration, security model, fork pull requests, CLI, and
  ten generated example reports.

[Unreleased]: https://github.com/theimdall/prproof/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/theimdall/prproof/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/theimdall/prproof/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/theimdall/prproof/releases/tag/v0.1.0
