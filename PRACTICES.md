# Practices

Engineering practices that don't need to be in front of you on every
turn — testing craft, code structure, dependencies, refactoring, coverage, CI,
type safety, verification, code quality. `AGENTS.md` holds the rules an agent
gets wrong without being told; this file holds the ones it can look up when
the task calls for them. `AGENTS.md` points at the section each task needs.

Two kinds of content, same as `AGENTS.md`:

- **Principles** — apply to every project regardless of language or stack.
- **Defaults for this stack** (clearly labeled) — concrete tool picks for a
  fresh TypeScript/Vite web project. If the project already uses something
  else, adapt the principle; don't convert the project.

Every rule has a stable ID (`DEP-1`, `CI-3`, …) so a review, a lint message,
or a PR comment can cite it and you can resolve it without re-reading the
file. IDs never get reused for a different rule.

## Testing craft

`AGENTS.md` carries the testing rules that are easiest to skip under
pressure — TEST-1 (a plan without test work is an incomplete plan), TEST-2
(real assertions, not existence checks) and TEST-3. This is the rest.

- **TEST-4** — Test behavior, not implementation. Test names describe what the
  system does, not what the code calls. A test that breaks on a rename but not
  on a behavior change is testing the wrong thing.
- **TEST-5** — Cover sizes 0, 1, 2, and N for any function that takes a
  collection. Round-trip any encode/decode, save/load, or serialize/parse
  pair — the pairing is the assertion.
- **TEST-6** — Mock at architectural seams (storage, network, time), not at
  every function boundary. A test that mocks the thing it's testing asserts
  the mock. No snapshot tests for computed values; snapshots are for rendered
  output.
- **TEST-7** — Some files are correctly untested: bootstrap files, type-only
  files, pure-presentation components with no logic, unreachable type guards.
  Say so rather than padding them with filler.
- **TEST-8** — Unit and E2E tests answer different questions — unit tests
  verify individual logic, E2E verifies the pieces work together. Aim for
  both, and merge the coverage measurements when the tooling allows (COV-1..3).

## Code structure details

`AGENTS.md` carries STRUCT-1..3 and STRUCT-6. The rest:

- **STRUCT-4** — One clear responsibility per function. If you can't name
  what it does in one sentence, split it.
- **STRUCT-5** — Predictable named exports, no hidden global state, no clever
  metaprogramming. Explicit return types on public functions. Discriminated
  unions over boolean flags when a value can be in one of several states.
- **DUP-1** — Two identical blocks is usually fine. Three is borderline —
  extract if non-trivial. Four or more: extract.
- **DUP-2** — Centralize shared constants, regexes, magic strings, and
  repeated parsing patterns.
- **DUP-3** — Three similar lines beat a premature abstraction. Never extract
  a helper for one caller.

## Dependencies

- **DEP-1** — Prefer maintained packages: recent releases, real usage, not
  archived.
- **DEP-2** — Don't add a package for something a few lines can do.
- **DEP-3** — Run `npm audit` after adding or updating packages. Fix any
  vulnerabilities before committing. Treat security warnings as build
  failures.
- **DEP-4** — Pin major versions in `package.json` to avoid surprise
  breaking changes from upstream updates.
- **DEP-5** — Check what a package does before installing it; a well-known
  alternative usually beats an obscure suggestion.

## Refactoring

- **REF-1** — Refactoring untested code is high-risk. Establish reasonable
  test coverage before significant refactors.
- **REF-2** — Refactoring means same behavior, better shape. Existing tests
  must still pass **without modification** — if a test had to change, it
  wasn't a refactor.
- **REF-3** — Run the suite after each change during a refactor, not just at
  the end.
- **REF-4** — No speculative future-proofing. Don't build abstractions for
  requirements that don't exist yet.
- **REF-5** — No backwards-compatibility shims. If something is unused,
  delete it completely.

## Coverage Setup

- **COV-1** — Core business logic (calculations, data transformations)
  should aim for near-100% coverage. UI components and framework glue can be
  lower.
- **COV-2** — Don't enforce hard coverage thresholds that fail the build —
  they incentivize gaming the number. Use coverage as a guide, not a gate.
- **COV-3** — Coverage finds *untested* code. It does not tell you whether
  *tested* code is well tested.

**Default for this stack** (TypeScript + Vite + Vitest + Playwright):

- **Start simple**: use Vitest's built-in coverage (`vitest run --coverage`)
  from day one. Enough to see which code is tested.
- **Add E2E coverage later**: once there are Playwright tests, collect
  coverage with `monocart-reporter` behind an `E2E_COVERAGE` env var.
- **Then merge**: `monocart-coverage-reports` combines unit and E2E raw V8
  data into one report. Organize output as `coverage/unit/`, `coverage/e2e/`,
  `coverage/merged/`. Full guide: `TESTING-PIPELINE.md`.

**In a Jest/pytest/etc. project**, use that ecosystem's tooling
(`jest --coverage`, `pytest-cov`). COV-1..3 still apply; the commands differ.

## CI / Automation

- **CI-1** — Set up CI early. Tests run automatically on every push and on
  pull requests to the default branch. A test suite that only runs locally is
  a test suite that gets skipped.
- **CI-2** — Run a dependency security audit (`npm audit`, `pip-audit`, …)
  early in the pipeline. If it finds vulnerabilities, fail before running
  tests.
- **CI-3** — Upload coverage reports and build artifacts with a reasonable
  retention (14 days), and post the coverage summary to the job summary so
  it's visible without downloading anything.
- **CI-4** — **In brownfield repos, audit before adding.** Many repos have
  several gates (PR check, deploy check, pre-commit hook). Map what each one
  runs *before* assuming you need a new workflow — you may just need to fix
  what's already there.

**Default for this stack** (GitHub Actions + Vitest + Playwright):

- Pipeline order: install → `npm audit` → type check → unit tests with
  coverage → install Playwright browsers → E2E with coverage → merge coverage
  → upload artifacts.
- `TESTING-PIPELINE.md` has a complete, ready-to-copy workflow.

**On GitLab CI / CircleCI / Vercel / Jest** the order is the same; the YAML
and the runner change.

### Pre-push hook (mirror the CI gate locally)

CI catching a red suite *after* you've pushed is too late — and a push can
trigger deploys.

- **CI-5** — Put the hook at `.githooks/pre-push` (version-controlled, unlike
  `.git/hooks/`) and activate it once per clone with
  `git config core.hooksPath .githooks`.
- **CI-6** — Run the gate CI runs, minus the slow parts: type check plus the
  unit suite (`npm test`, or `pytest`). Skip coverage and E2E — they only add
  wall-clock; a failing assertion fails the same without them.
- **CI-7** — `git push --no-verify` is for genuine emergencies, never a
  routine way to push past a red suite.

- **CI-8** — Keep it to **one** gate per stage. A second pre-push hook or a
  second workflow doubles what has to be remembered — and doubles what has to
  be bypassed in an emergency. New checks extend the existing hook and the
  existing workflow; `/jgl-setup-harness` is written to append to them rather
  than write its own.

Adapt to the stack: Node runs `tsc -b && npm test`; Python runs `pytest`.
`/jgl-setup-testing` writes this hook alongside CI.

## Language and Type Safety

- **LANG-1** — Statically typed languages are strongly recommended. Type
  systems catch entire categories of bugs before tests run, and they make
  LLM-assisted coding meaningfully more effective — the agent can reason
  about types instead of guessing at shapes.
- **LANG-2** — In a brownfield project the language and framework are already
  chosen. Don't migrate. Apply the principle: lean into the existing type
  system, don't bypass it with `any` or `# type: ignore`.

**Defaults for fresh projects:** TypeScript over plain JavaScript; type hints
throughout if using Python; React + TypeScript for web apps (largest
ecosystem, most LLM training data, broadest community support).

## Verification

DONE-1 in `AGENTS.md` defines when a change is finished (tests and type check
pass, new behavior has a test, results reported). Two situations it doesn't
spell out:

- **VER-3** — After installing or updating packages, run `npm audit` and
  report the result.
- **VER-4** — If the project has a build step, run it after changes. Type
  errors and lint failures often surface in the build even when tests pass.

## Code Quality

- **QUAL-1** — Good code quality needs both static analysis and tests.
  Linters catch structural issues; tests catch behavioral ones. Neither alone
  is sufficient.
- **QUAL-5** — **Complexity is a drift sensor, not a gate.** Agent-written
  code measures worse than human code on cyclomatic and cognitive complexity,
  so the number is worth watching — but a hard threshold is satisfied by
  splitting one honest branchy function into three dishonest ones. Same
  failure mode as COV-2. Track the trend; act on a climb, not on a reading.
- **QUAL-2** — Prefer explicit code over compact code. No nested ternaries or
  clever one-liners that sacrifice readability.
- **QUAL-3** — Delete dead code; don't comment it out. Version control is the
  undo button.
- **QUAL-4** — Don't add error handling for scenarios that can't happen.
  Validate at system boundaries (user input, external APIs) only.
