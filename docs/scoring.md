# Scoring

A score is only useful if you can argue with it. This page describes the whole model; there is
nothing else to it.

## The formula

```text
score = clamp(0, 100, min(100 − warnings − hard, ceiling))
```

where

- **warnings** is the sum of penalties from INFO and WARNING rules, capped at the warning
  budget (35 by default),
- **hard** is the sum of penalties from HIGH and CRITICAL rules,
- **ceiling** is 45 if any CRITICAL rule failed, 74 if any HIGH rule failed, and 100 otherwise.

Each penalty is `round(weight[rule] × factor)`, where `factor` is 1 unless the rule scales its
own cost (see [PR001](#pr001-scales-with-the-overshoot) and non-required checks).

Only rules with status **failed** contribute. **Passed**, **skipped** and **unknown** cost
nothing, ever.

## Default weights

| Rule       | Severity | Weight | Notes                                                   |
| ---------- | -------- | -----: | ------------------------------------------------------- |
| `BUILD001` | CRITICAL |     40 | halved and downgraded to HIGH when `required: false`    |
| `TEST001`  | CRITICAL |     40 | same                                                    |
| `LINT001`  | HIGH     |     12 | halved and downgraded to WARNING when `required: false` |
| `TEST002`  | WARNING  |     15 |                                                         |
| `PR001`    | WARNING  |     12 | scaled by overshoot, minimum half                       |
| `PR002`    | WARNING  |     12 |                                                         |
| `DUP001`   | WARNING  |     12 |                                                         |
| `PR003`    | INFO     |      4 | only evaluated when `require_issue_reference: true`     |
| `DEP001`   | WARNING  |      3 | one third for lock-only or unparsable manifests         |
| `DOC001`   | INFO     |      0 | a modifier, never a penalty                             |

Change any of them:

```yaml
scoring:
  weights:
    TEST002: 20
    DUP001: 5
  warning_budget: 30
```

The ceilings are deliberately **not** configurable. They are what make a score comparable
between two repositories, and what stops "90/100" from being achievable with a broken build.

## Why ceilings

Plain subtraction produces a model that disagrees with every reviewer's intuition:

```text
100 − 40 (tests failed) = 60 → "REVIEW REQUIRED"
```

Sixty out of a hundred reads as _mediocre_. A pull request whose tests fail is not mediocre; it
is not ready. With the ceiling:

```text
100 − 40 = 60  →  capped at 45  →  HIGH RISK
```

The same logic runs the other way. Five warnings with no critical failure should not be able to
produce "HIGH RISK", because then the band means nothing when it matters. That is the warning
budget: everything INFO and WARNING put together can cost at most 35 points, so warnings alone
land at 65 — REVIEW REQUIRED at worst.

## Bands

| Score  | Band            | Meaning                                                          |
| ------ | --------------- | ---------------------------------------------------------------- |
| 90–100 | EXCELLENT       | Nothing to say. Start reviewing.                                 |
| 75–89  | GOOD            | Worth reviewing; one or two things to mention.                   |
| 50–74  | REVIEW REQUIRED | Something needs attention before or during review.               |
| 0–49   | HIGH RISK       | Something is broken, or the change is unreviewable as it stands. |

## PR001 scales with the overshoot

A pull request 10 % over the limit and one 300 % over it are not the same problem, so the size
penalty is graduated:

```text
factor = min(1, 0.5 + (overshoot − 1) × 0.5)
```

With `max_changed_files: 20` and a weight of 12:

| Files | Overshoot | Factor | Points |
| ----: | --------: | -----: | -----: |
|    20 |       1.0 |      — |      0 |
|    22 |       1.1 |   0.55 |      7 |
|    30 |       1.5 |   0.75 |      9 |
|    40 |       2.0 |    1.0 |     12 |
|    80 |       4.0 |    1.0 |     12 |

Crossing the line at all costs half the weight; twice the limit costs all of it. The same
calculation runs against `max_changed_lines`, and the worse of the two wins.

## Non-required checks

A check configured `required: false` that fails is both downgraded one severity level and
charged half its weight:

| Check      | `required: true` | `required: false` |
| ---------- | ---------------- | ----------------- |
| `BUILD001` | CRITICAL, 40     | HIGH, 20          |
| `TEST001`  | CRITICAL, 40     | HIGH, 20          |
| `LINT001`  | HIGH, 12         | WARNING, 6        |

## Worked examples

These come from [docs/examples](examples), which is generated from the test fixtures — the
numbers below are asserted by the test suite, not written by hand.

### 100 / 100 — EXCELLENT

Two files, a test alongside the source change, a real description, a linked issue, no dependency
changes, no duplicate. Nothing failed.

### 85 / 100 — GOOD (`no-test-changes`)

```text
  100  base
  -15  TEST002   No test files changed
  ---
   85  GOOD
```

### 88 / 100 — GOOD (`potential-duplicate`)

```text
  100  base
  -12  DUP001    Possible duplicate pull request
  ---
   88  GOOD
```

### 45 / 100 — HIGH RISK (`failed-build`)

```text
  100  base
  -40  BUILD001  Build failed
  ---
   60  subtotal
   45  capped at 45 because a critical check failed
   45  HIGH RISK
```

### 25 / 100 — HIGH RISK (`high-risk`)

Failing tests, a failing non-required lint, 35 files, no tests, a new dependency, a duplicate and
an empty description:

```text
  100  base
  -40  TEST001   Tests failed
  -15  TEST002   No test files changed
  -12  DUP001    Possible duplicate pull request
  -12  PR001     Large pull request
  -12  PR002     Missing description
   -6  LINT001   Lint failed
   -3  DEP001    New dependency added
       (warning budget reached: 25 further points not applied)
  ---
   25  HIGH RISK
```

Note the last line before the total: the warnings had asked for 60 points and were granted 35.
Without the budget this pull request would score 0 instead of 25 — and a pull request that is
merely messy would be indistinguishable from one that is broken.

## Failing the build

Scoring and blocking are separate on purpose. The score is advice; `fail_on` is policy:

```yaml
fail_on: [critical] # default: only a failing build or test suite blocks
fail_on: [critical, high] # stricter: lint too
fail_on: [] # never block; report only
```

A gate that blocks on advice gets removed. A gate that blocks on a red build gets kept.
