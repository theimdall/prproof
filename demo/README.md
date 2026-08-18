# Demo

A 20–30 second recording that shows what PRProof does, without narration.

## The two pull requests

Both reports below are real output, generated from the test fixtures by `npm run demo`:

|                                                    | Score                 | Report                                                |
| -------------------------------------------------- | --------------------- | ----------------------------------------------------- |
| **The pull request nobody should start reviewing** | 25 / 100 — HIGH RISK  | [high-risk.md](../docs/examples/high-risk.md)         |
| **The pull request you want**                      | 100 / 100 — EXCELLENT | [small-good-pr.md](../docs/examples/small-good-pr.md) |

The bad one fails tests, changes 35 files, touches no tests, adds a dependency, duplicates an
open pull request and has no description. The good one changes two files, one of which is a
test, and explains itself.

## Setting up a demo repository

`setup-demo-repo.sh` builds a small repository with a passing build, a test suite, and two
branches ready to open as pull requests.

```console
cd demo
./setup-demo-repo.sh ~/prproof-demo
cd ~/prproof-demo

gh repo create prproof-demo --public --source=. --push
gh pr create --head good-change  --title 'Expire sessions on logout' --body-file .github/good-pr-body.md
gh pr create --head risky-change --title 'wip'
```

PRProof runs on both. Wait for the comments.

## Recording

Keep it silent and fast. Six shots, roughly five seconds each:

1. The pull request list, showing two open pull requests.
2. Open the bad one. Scroll to the PRProof comment: **25 / 100 — HIGH RISK**, red row for tests.
3. Expand **How this score was calculated** — the arithmetic, every line tied to a rule id.
4. Open the good one: **100 / 100 — EXCELLENT**, a table of ticks.
5. The Checks tab, showing the PRProof check on both.
6. The `.prproof.yml` file — eight lines — and the workflow, twelve.

The point the recording has to make in the first five seconds: **you learn whether a pull
request is worth reviewing without opening the diff.**

## Notes

- Record at 1280×720 or larger; GitHub comments are wide.
- Light theme reads better in a compressed video.
- Do not speed up the score breakdown shot — it is the part that makes people trust the number.
