# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/theimdall/prproof/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/theimdall/prproof/releases/tag/v0.1.0
