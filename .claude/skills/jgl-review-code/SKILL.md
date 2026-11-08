---
name: jgl-review-code
description: Reviews the whole codebase's structure — change shape from git history, duplication, dead code, logic tangled into framework code, type gaps, dependency health — and produces a prioritized refactor plan if one is warranted. A repo-wide structural review, not a review of the current diff. Use when the user says "review code", "/jgl-review-code", "anything need refactoring?", or "look over the code".
context: fork
background: false
---

# Review Code

Review the codebase's structure and, if it's warranted, plan refactors.
Report and plan only — don't change code.

## Evidence

Gather all four, and when a tool isn't configured, report it as
`⊘ SKIPPED — <tool> not configured (<setup hint>)` rather than leaving it
out. A silent skip looks like a clean result.

1. **The code** — read it.
2. **Static analysis** — the project's type checker and linter (see the
   Commands table in `AGENTS.md`).
3. **Change history** — run `scripts/change-shape.sh` from this skill's folder
   (`.claude/skills/jgl-review-code/` or `.agents/skills/jgl-review-code/`).
   It lists recent feature commits with how many files and top-level
   directories each touched, and the files that show up in most commits. This
   is the only evidence of how the code behaves *under change*.
4. **Coverage** — the project's coverage command. Low coverage on
   logic-heavy files often means logic is welded to framework code.

## Pass 1 — collect everything

Write down every issue you find, with file, line range, and your confidence,
before deciding what matters. Don't filter yet — a finding dropped here can't
be weighed later.

- **Change shape.** Read the commits `change-shape.sh` flagged, don't just
  count them. A feature that needed edits in nine files across four layers is
  a coupling finding that no size or complexity number will surface. Name it:
  *shotgun surgery* (the same kind of edit forced across many files),
  *layer-crossing* (every feature touches UI, logic, storage and config), or a
  *repeat offender* (one file in nearly every change). Say what the
  well-shaped version would have touched. Renames, lockfile bumps and
  genuinely cross-cutting changes legitimately touch many files.
- **Duplication** — the same logic in three or more places (DUP-1).
- **Dead code** — unused exports, commented-out blocks, unreachable branches.
- **Tangled logic** — business rules inside components, handlers, or other
  framework glue where they can't be unit tested.
- **Type gaps** — `any`, unsafe casts, untyped public functions.
- **Security** — hardcoded secrets, missing validation at system boundaries.
  Flag these at the top regardless of anything else.
- **Dependencies** — the audit tool's findings.

## Pass 2 — decide

Separate **findings** (a concrete defect with a concrete fix) from **drift
signals** (a measurement whose single reading means little: file length,
complexity, coverage percentage). QUAL-5 is why: a threshold on complexity is
met by splitting one honest function into three dishonest ones. A drift signal
becomes a finding only when it points at something already in the list —
"`pricing.ts` is 900 lines" is a signal; "`pricing.ts` holds the tax table,
the cart math and the Stripe client" is a finding.

A refactor is warranted if any of these hold: features repeatedly land wide or
through one repeat-offender file; logic duplicated 3+ times; business logic
that can't be unit tested; a file carrying more than one responsibility (name
them); one concept fragmented across many tiny files (STRUCT-2); moderate or
worse audit findings; `any` in core logic. Otherwise say no refactor is
needed, give the drift readings in a line or two, and stop.

Leave out formatting nits and speculative future improvements. Code without
tests isn't a refactor candidate yet — mark it "tests first" and point at
`/jgl-review-testing`.

## Plan

1. **Do first** — high value, low risk (extract duplicated logic, fix audit
   findings, cut the coupling behind a wide feature diff).
2. **Do second** — medium value (pull tangled logic into pure modules, split a
   multi-responsibility file, replace `any`).
3. **Skip for now** — real but not worth it yet, with one line on why.

Each item: file path, what's wrong, the concrete fix ("move lines 45–120 of
`api/orders.ts` into `lib/order-totals.ts`"). Close with a separate **Drift**
block of the readings (and last run's values if known), so nobody mistakes a
reading for a task.
