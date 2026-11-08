---
name: jgl-check
description: Runs every check the project has — dependency audit, type check, tests, build, and the optional structure, complexity and secrets-manifest checks — and reports them grouped into gates and drift signals, with an explicit SKIPPED line for anything not installed. Use when the user says "check", "/jgl-check", "verify", or "is everything passing".
context: fork
background: false
---

# Check

Run every check the project has and report each one honestly: passed, failed,
or skipped because the tool isn't there. A skip that reads like a pass is the
failure this skill exists to prevent — the user would believe an audit ran
that didn't. Run read-only commands only; never decrypt, edit, or fix.

## Find the project's real commands

From the repo root, run `scripts/detect-stack.sh` from this skill's folder
(`.claude/skills/jgl-check/` or `.agents/skills/jgl-check/`). It prints the
package manager, the relevant scripts, the type system, what CI runs, and which
optional kit modules are installed.

Use the project's commands, never the kit's defaults. When sources disagree,
trust the Commands table in `AGENTS.md` first, then what CI runs, then the
package scripts — in brownfield repos CI is usually the truest record.

## What to run

Run every line, even after one fails — the user wants the whole picture.

**Gates** (a failure blocks a push):

- **audit** — the ecosystem's audit (`npm audit`, `pnpm audit`, `pip-audit`,
  `cargo audit`, …).
- **types** — the type checker. No type system at all (plain JS, untyped
  Python) is `⊘ N/A`, not a finding, though adding types is usually worth it.
- **tests** — the test command CI runs. No test framework at all is
  `✗ NO TEST FRAMEWORK`, a finding; offer `/jgl-setup-testing`.
- **structure** — `bash scripts/harness.sh check` if the harness module is
  installed. It prints its own lines; pass them through.
- **secrets** — `bash scripts/secrets.sh validate` (keyless) if the secrets
  module is installed. Omit the line entirely when it isn't.

**Drift signals** (worth watching, never a failure — QUAL-5):

- **complexity** — from `harness.sh`, which never fails on it.
- **coverage** — if a coverage command exists.

**build** — if a build step exists; `⊘ N/A` if not.

A missing tool is `⊘ SKIPPED — <why> (install: <command>)` and counts as a
finding. If the harness module isn't installed, report both structure and
complexity as skipped — STRUCT-1 and STRUCT-6 have nothing enforcing them —
and mention `/jgl-setup-harness` once.

## Report

```
Gates — a failure here blocks the push
  ✓ types       tsc — clean
  ✗ tests       3 failed of 47 (src/lib/cart.test.ts:22, :31, :44)
  ✓ audit       npm audit — 0 vulnerabilities
  ⊘ structure   SKIPPED — harness module not installed (/jgl-setup-harness)

Drift signals — watch the trend, don't gate on the number
  ⊘ complexity  SKIPPED — harness module not installed
  ✓ coverage    81% statements (was 79% last run)

  ⊘ build       N/A — no build step
```

Markers: `✓` passed, `✗` failed, `!` over a drift threshold, `⊘` skipped or
N/A (always with a reason). Put failing output and install commands under the
summary.

Don't turn a drift signal into a gate or report one as a failure. If one is
climbing, say so in a sentence under the summary ("complexity warnings went
1 → 4 over three runs, all in `src/lib/pricing.ts`").
