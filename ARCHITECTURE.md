# The Harness

This kit is a **harness**: the set of controls around an AI agent that make its
output trustworthy without a human reading every line. Controls come in two
kinds, and knowing which kind you're holding tells you where it belongs.

- **Guides** steer *before* the agent acts — steering docs, conventions,
  skills. Feedforward.
- **Sensors** observe *after* — type checkers, tests, structural linters,
  review. Feedback.

Cutting across both: **computational** controls are deterministic, run in
milliseconds to seconds, and are reliable; **inferential** controls are
LLM-judged, slower, and probabilistic. Prefer computational where a
computational check exists. Reach for inferential only where meaning, not
form, is the thing being checked.

Naming the layers is what makes placement decidable. A control in the wrong
layer is either ignored (too slow for the loop it's in) or trusted too much
(too probabilistic for the gate it's guarding). Setup lives in
`/jgl-setup-testing` and `/jgl-setup-harness`; `optional/harness/README.md`
covers the two sensors this kit installs.

## What this kit ships

### Guides — all inferential

| Guide | What it steers |
|---|---|
| `AGENTS.md` | The rules an agent gets wrong without being told, plus this project's commands and what "done" means. Every tool reads it; `CLAUDE.md` imports it for Claude Code. Deliberately short — keep it under ~150 lines and move anything longer into a lookup doc or a skill. |
| `PRACTICES.md` | The rest, looked up on demand — testing craft, code structure, dependencies, refactoring, coverage, CI, types. |
| `TESTING-PIPELINE.md`, `SECRETS-PIPELINE.md` | Stack-specific implementation, read when the task calls for it. |
| `/jgl-scope`, `/jgl-init` | Procedures that shape a session before code is written. |

**Guides are a weak lever, and it is worth knowing why.** Three 2026 results
measured it directly:

- Gloaguen et al. (ETH Zürich, arXiv 2602.11988) found that context files
  "do not generally improve task success rates, while increasing inference
  cost by over 20%", and that repository overviews in particular don't help.
- Lulla et al. (arXiv 2601.20404) found an `AGENTS.md` cut median runtime by
  about 29% and output tokens by about 17% at similar completion rates — a
  file helps the agent find its way, not get the answer right.
- McMillan (arXiv 2605.10039, 1,650 Claude Code sessions) varied rules-file
  size, instruction position, file architecture and cross-file contradictions
  and found no detectable effect from any of them. What it *did* find is in
  "Session length" below.

OpenAI's own account of building a product entirely with agents (Lopopolo,
"Harness engineering", February 2026) lands in the same place from practice:
one big instruction file failed, and a ~100-line `AGENTS.md` that works as a
table of contents — pointing into docs the agent reads when a task needs
them — replaced it.

So the kit's always-loaded file stays small and carries only what an agent
can't infer: this project's commands, what "done" means, what needs the
user's go-ahead, and the handful of rules agents get wrong. Everything else
is a lookup, and anything that can be checked mechanically moved into a
sensor.

### Sensors — computational

| Sensor | Tool | Where it runs | Gates? |
|---|---|---|---|
| Types | `tsc` | agent loop, pre-push, CI | yes |
| Tests | Vitest / pytest / … | agent loop, pre-push, CI | yes |
| Dependency audit | `npm audit`, `pip-audit` | CI | yes |
| Secrets manifest | `scripts/secrets.sh validate` | pre-commit, CI | yes |
| AI attribution (GIT-1) | `.githooks/commit-msg` | every commit, any tool | yes |
| Secret reads, force push, `--no-verify`, pasted keys | `optional/agent-guards` (Claude Code hooks, Codex rules) | every tool call | yes |
| Structure | `dependency-cruiser` | pre-push, CI | yes |
| Complexity | ESLint `complexity`, `max-depth` | reported by `/jgl-check` | **no** |
| Coverage | Vitest / monocart | CI, reported | **no** |

`/jgl-check` runs the whole column and reports it in one place, including an
explicit `⊘ SKIPPED` line for anything not installed.

### Sensors — inferential

| Sensor | Where it runs |
|---|---|
| `/jgl-review-code` | on request, outside the change lifecycle |
| `/jgl-review-testing` | on request, before a refactor or after a coverage gate fails |
| `/jgl-status` | between working stretches |

These are drift detection, not gates. They are slow, they are probabilistic,
and they surface judgement calls — which is exactly why they belong outside the
commit path and in front of a human.

## Where a control belongs

**In the agent's own loop** — anything under a few seconds. Type check, unit
tests. Fast enough that the agent self-corrects without a human turn, which is
the entire value: a sensor the agent can run is worth more than one that fires
after the work is handed over.

**At pre-push** — the same fast gate, plus the structural sensor. Catches the
red suite before it becomes a CI email, or a deploy. `/jgl-setup-testing`
writes this hook; `/jgl-setup-harness` extends it. One hook, one bypass flag
(`--no-verify`) to remember.

**In CI** — everything, including the slow parts: E2E, coverage merge,
dependency audit. Wall-clock doesn't matter here.

**Outside the change lifecycle entirely** — the inferential reviews and the
non-gating counts. Complexity and coverage live here on purpose. Both are real
signals and both get gamed the moment they become thresholds: a complexity gate
is satisfied by splitting one honest function into three dishonest ones, and a
coverage gate by tests that assert nothing (COV-2). Watch the trend, don't
gate on the number.

## Session length

The largest effect in the McMillan study wasn't a property of the rules file
at all. Compliance fell *within* a session as the agent generated more code —
about 5.6% lower odds of following a rule per additional function, on
average, in the range tested. Read it with its caveats: the effect is
non-monotonic rather than a steady per-step decline, it was found during
analysis rather than tested as a planned hypothesis, and it was measured on
Sonnet 4.6 and Opus 4.6/4.7. Newer models may drift less.

The response is cheap enough to take anyway: commit and continue in a fresh
session rather than pushing one session further (GIT-5). A checkpoint costs a
minute, and drift has no other signal — no sensor above fires on it. A fresh
session needs to know where things stand, so the checkpoint writes
`docs/PROGRESS.md` (done, in flight, next step, open questions) and the next
session starts from that plus `git log`.

`/jgl-status` carries the triggers: files changed and lines added since the
last commit (the measured driver, so a short stretch of heavy generation
counts and a long stretch of reading does not), and uncommitted work older
than two hours (a proxy).

## Garbage collection

Drift accumulates between features — duplicated helpers, stale docs, tests
that no longer test anything. OpenAI's harness write-up runs recurring
background agents for exactly this. The kit's version is lighter: run
`/jgl-review-testing` and `/jgl-review-code` on a cadence (every few weeks, or
every few features), not only when something already feels wrong, and act on
the findings while they are small.

## What this harness does not cover

Fowler's open question is worth carrying deliberately rather than discovering
later: **when sensors never fire, does that mean the code is good or that the
detection is inadequate?** A green board is not evidence of quality by itself.
Known gaps in this one:

- **No sensor reads intent.** Every computational check above verifies form.
  That the code does the *right* thing is checked only by tests someone wrote
  and by review — both inferential, both fallible.
- **Tests written by the same agent that wrote the code** share its
  misunderstandings. A passing suite an AI wrote against code it wrote is
  weaker evidence than the green tick suggests. `/jgl-review-testing` flags
  this class specifically.
- **Structural rules only fire where they're pointed.** A `dependency-cruiser`
  rule whose paths don't match this repo's layout passes silently forever.
  `/jgl-setup-harness` requires proving each rule fires against a deliberate
  violation before trusting it — for exactly this reason.
- **Nothing detects a missing test.** Coverage finds untested *code*; no tool
  finds the untested *case* in a covered function (COV-3).
- **Secrets:** the pre-commit guard and the agent guards catch known shapes
  and the common ways of reading a secret file. SEC-1..5 are still guides for
  everything else, and a novel secret format passes.

The gaps are the argument for keeping a human at the review, not for adding
more gates. A good harness directs human attention to where it matters — it
doesn't try to remove it.
