# Contributing

Thanks for considering it. PRProof is small on purpose, and the fastest way to get a change
merged is to keep it that way.

## Getting started

```console
git clone https://github.com/theimdall/prproof.git
cd prproof
npm install
npm run verify      # format check, lint, typecheck, tests
```

Useful commands:

| Command              | What it does                                               |
| -------------------- | ---------------------------------------------------------- |
| `npm test`           | Run the test suite                                         |
| `npm run test:watch` | Watch mode                                                 |
| `npm run coverage`   | Coverage report (85 % lines on core and adapters)          |
| `npm run typecheck`  | `tsc --noEmit`                                             |
| `npm run lint`       | ESLint                                                     |
| `npm run demo`       | Regenerate `docs/examples/*.md` from the scenario fixtures |
| `npm run package`    | Build the library and bundle both actions into `dist/`     |

`dist/` is committed, because GitHub Actions runs JavaScript actions from a bundle rather than
from source. It is built with esbuild rather than ncc for one reason: ncc assigns module ids in
filesystem-walk order, so Windows and Linux produced byte-different bundles from identical
source and the CI freshness check could never pass for everyone. esbuild emits the same bytes on
every platform.

## The shape of the codebase

```text
src/core/       pure. No network, no subprocesses, no file system, no @actions/*
src/adapters/   git, command execution, check resolution
src/github/     Octokit
src/cli/        prproof analyze
src/action/     the two GitHub Actions entry points
```

`core/` staying pure is enforced by `tests/unit/architecture.test.ts`, not by good intentions.
If your change makes `core/` reach for the network or the file system, the layering is telling
you something.

## Adding a rule

1. Create `src/core/rules/<name>.ts` exporting a `Rule`.
2. Register it in `src/core/rules/registry.ts` (order is report order).
3. Give it a default weight in `DEFAULT_WEIGHTS` (`src/core/config/schema.ts`).
4. Add a row to `TABLE_ROWS` in `src/core/render/markdown.ts` if it belongs in the summary table.
5. Test it in `tests/unit/rules.test.ts` — at minimum: fires, does not fire, and is skipped.
6. Document it in `docs/rules.md`.
7. Run `npm run demo` and review the diff in `docs/examples/`. That diff is what users will see.

A rule is a good fit when it is deterministic, explainable, and unlikely enough to be wrong that
a maintainer will not switch PRProof off because of it. A rule that is right 80 % of the time is
worse than no rule: it teaches people to ignore the report.

Rules must be pure. Everything a rule needs is on `AnalysisContext`; if something is missing,
add it to the context builder rather than doing I/O inside the rule.

## Changing scoring

Weights are fair game — argue for the number in the pull request. The severity ceilings
(`CRITICAL_CAP`, `HIGH_CAP`) and the warning budget are load-bearing: they are what make scores
comparable between repositories. Changing them needs a strong case.

Any scoring change means `npm run demo` and a look at every example diff.

## Security-sensitive areas

Changes to these get read closely, and need tests:

- `src/adapters/exec/command.ts` — command parsing, allowlist, privileged-context refusal
- `src/action/envelope.ts` — validation of the artifact the privileged job reads
- `src/core/render/sanitize.ts` — everything that goes into a comment
- `src/core/config/` — configuration parsing

If you find a vulnerability, please read [SECURITY.md](SECURITY.md) instead of opening an issue.

## Style

- TypeScript, strict; no `any`, no non-null assertions in `src/`
- Prettier and ESLint decide formatting — `npm run format`
- Comments explain _why_, not _what_. If a line needs a comment to say what it does, rename
  something instead.
- Commit messages: imperative mood, one line, body if it needs one

## Pull requests

Small, focused, tested. Fill in the template. PRProof analyses its own pull requests, so you
will get a report on yours — if it complains about something you disagree with, say so in the
pull request. That feedback is more valuable than the score.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
