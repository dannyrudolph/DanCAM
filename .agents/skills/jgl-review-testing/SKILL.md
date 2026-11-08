---
name: jgl-review-testing
description: Audits the test suite for substance — weak assertions, untested logic, AI-written tests that assert the implementation instead of the requirement, and CI gates that can't actually fail — and produces a prioritized testing plan if one is warranted. Use when the user says "review tests", "/jgl-review-testing", "audit tests", "are my tests any good?", or before a refactor.
context: fork
background: false
---

# Review Testing

Judge what the tests actually verify, not how the coverage number looks.
Report and plan only — don't write tests.

## Evidence

1. **The tests themselves** — read what each one asserts.
2. **A run** — the project's test and type-check commands (Commands table in
   `AGENTS.md`); note failures.
3. **Coverage** — the coverage command. If none is configured, that's
   `⊘ SKIPPED — no coverage tooling (<setup hint>)` and a finding.
4. **The CI gates** — see below. Local green means little if CI runs a subset
   or can't fail.

## The gate inventory (do this first)

Open every CI workflow, deploy config, and git hook, and write a short table
the user can confirm: which gate runs on PRs, which at deploy, which locally,
and which suites no gate runs at all. Then map each test file to the gate that
runs it. A test file no gate runs is as bad as a missing test — someone meant
it to run. A deliberately curated fast gate (a `test:reliable` subset at PR
time with the full suite at deploy) is legitimate; it's a finding only when
it's presented as the whole suite.

Check that each gate can actually fail the build: look for
`continue-on-error: true`, `|| true`, `exit 0`, `paths:` filters that skip
test directories, committed `.only` / `.skip`, test-discovery patterns that
miss files on disk, generated files the tests import being built *after* the
test step, and files reporting "0 tests" (often a failed import). Note whether
the test workflow is a required check on the default branch, if you can tell.

## Pass 1 — collect everything

List every issue with file and line before deciding what matters:

- **Untested logic** — source files with real business logic and no tests.
- **Weak assertions** — `toBeDefined()`, `not.toBeNull()`, `assert.ok(x)`,
  regex-matches-anything. They pass when the code is wrong (TEST-2).
- **Missing edges** — collection functions tested at one size only (try 0, 1,
  2, N); encode/decode or save/load pairs without a round trip.
- **Over-mocking** — mocks below the architectural seams (storage, network,
  time), so the test verifies the mock.
- **Tests that assert the implementation** — the sharpest form, and common in
  AI-assisted code: when the same agent writes code and tests, the tests are
  derived from the code that exists, not the behavior that was wanted, so they
  encode the bug and pass. As Böckeler puts it, that's a lot of faith in
  AI-generated tests. Symptoms: an expected value that's a literal plainly read
  off a run (`expect(total).toBe(107.53)` with nothing saying why); one test per
  branch, mirroring the code, including branches that can't happen (QUAL-4);
  mocks returning exactly what the code happens to ask for. The test to apply:
  state the requirement in one sentence *without* looking at the
  implementation, then ask whether the test would fail if the code broke it.
  If you can't state the requirement independently, that's the finding. Report
  this class even when coverage is excellent — coverage can't see it (COV-3).
- **CI gaps** from the inventory, on equal footing with missing tests.

## Pass 2 — decide

No action is needed when logic files have tests, assertions check values that
trace to a requirement, critical paths cover their edges, core logic is at
~80%+ coverage, and the full suite runs in CI on every PR and push to the
default branch with no way to soft-fail. Say so and stop.

Otherwise, plan:

1. **Do first** — CI gaps (they make every later improvement trustworthy),
   then tests for untested business logic and replacements for weak
   assertions.
2. **Do second** — round trips, contract tests for plugin-style interfaces,
   E2E for critical flows.
3. **Skip for now** — things that look like gaps but aren't worth it
   (framework bootstrap, pure presentation, unreachable guards — TEST-7), one
   line each.

Each item: the file, the behavior to test, unit or E2E ("test `calculateTotal()`
in `lib/pricing.ts` for zero items, one item, a discount, and tax"). For CI
items, the workflow file and the exact change. Pair with `/jgl-review-code`:
tests first, then refactor.

## Later passes

On a thinly tested codebase, expect 2–3 passes in a session. On a re-run, start
from what changed since the last pass (`git log`), compare coverage to last
time, and say plainly when the bar above is met rather than finding something
to justify another pass.
