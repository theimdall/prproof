# Security policy

## Reporting a vulnerability

Please report security issues **privately**, through
[GitHub Security Advisories](https://github.com/theimdall/prproof/security/advisories/new).

Do not open a public issue for a suspected vulnerability.

Include, as far as you can:

- what an attacker can achieve, and from what starting position (fork contributor? repository
  member?),
- the configuration and workflow trigger involved,
- a minimal reproduction.

You can expect an acknowledgement within 72 hours and an assessment within seven days. If the
report is valid, a fix and an advisory follow; credit is given unless you prefer otherwise.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

Until 1.0, only the latest minor version receives security fixes.

## What is in scope

PRProof runs in CI with access to a repository, so these are the things worth reporting:

- executing commands from a pull request in a context that has secrets or a write token,
- reading configuration from an untrusted source when it should come from the base branch,
- bypassing the command allowlist or the no-shell parser,
- content in a pull request that changes the shape of the report, forges the sticky-comment
  marker, or causes PRProof to edit a comment it does not own,
- the privileged reporting job posting a report onto the wrong pull request, or accepting an
  artifact that fails validation,
- leaking a token or secret into a comment, a check run, or a log.

## What is not in scope

- Weaknesses in a repository's own workflow, such as running untrusted code under
  `pull_request_target` with secrets. PRProof cannot fix that, and its documentation tells you
  not to do it.
- `mode: run` executing a command that the **base branch** configuration asked for. Anyone who
  can change the base branch can already run code in your CI.
- A rule producing a false positive or a false negative. That is a bug — please open a normal
  issue.
- Denial of service through a deliberately enormous pull request. Limits exist (3000 files,
  64 KB configuration, 600 s command timeout, 1 MB artifact) and reports say when they were hit.

## Design

The security model, its seven defences and their limits are documented in
[docs/security.md](docs/security.md). Reading it first will tell you whether something is
intended behaviour.
