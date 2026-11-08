# Harness module (structural + complexity sensors) — optional

A self-contained, **opt-in** module that installs the two *sensors* the kit's
steering docs describe but nothing previously enforced. It is **not active
until you install it** — the files here just sit under `optional/harness/`
doing nothing. To turn it on, run `/jgl-setup-harness` (or, if slash commands
don't work in your tool, read `skills/jgl-setup-harness/SKILL.md` and follow
it). To opt out, delete this folder.

Read `ARCHITECTURE.md` at the kit root first if the words *guide* and *sensor*
aren't yet doing any work for you — it's the one-page map of what this module
is a piece of.

## What it gives you

- **A structural sensor** — `dependency-cruiser` checking three rules the
  steering docs already state in prose and no test or type checker can see:
  no import cycles (STRUCT-1), no orphan modules (QUAL-3), and `src/lib/` never
  importing UI (STRUCT-6).
- **A complexity sensor** — ESLint `complexity` + `max-depth` at **warn**.
  Agent-written code measures worse than human code on both, so the trend is
  worth watching. It never fails a build; see "Why one gates and one doesn't".
- **One gate, not two.** `install-hook` extends the `.githooks/pre-push` hook
  `/jgl-setup-testing` already wrote, rather than adding a second hook with its
  own bypass flag to remember.
- **Honest skips.** Every check reports `⊘ … SKIPPED — <tool> not installed
  (install: X)` rather than quietly passing. A silent skip is worse than a
  failure.

## Why one gates and one doesn't

This is the whole design, so it's worth being explicit:

|  | structural | complexity |
|---|---|---|
| Tool | dependency-cruiser | ESLint |
| Severity | `error` | `warn` |
| Fails pre-push / CI | **yes** | **no** |
| Why | Cycles and layer violations are binary invariants a human decided on purpose. They don't get gamed and they don't have judgement calls. | A hard complexity threshold is satisfied by splitting one honest 13-branch function into three dishonest ones — worse code that scores better. Same reasoning COV-2 gives for coverage. |

The complexity number is a **drift signal**: a count that climbs over several
sessions is the thing to act on, not any individual warning.

## Requirements

Node, plus two devDependencies in your project:

```sh
npm install -D dependency-cruiser eslint
```

`/jgl-setup-harness` installs them for you and reports if either is missing.

## What's in this folder

```
optional/harness/
  scripts/harness.sh                the CLI (check/structure/complexity/
                                    install-hook/status)
  templates/
    dependency-cruiser.js           structural sensor config → .dependency-cruiser.js
    eslint.harness.js               complexity sensor config → eslint.harness.js
```

## How the skill installs it

`/jgl-setup-harness` audits what's already there, then (on your confirmation)
copies `scripts/harness.sh` into your project, writes the two configs with
their paths adapted to **this** repo's layout, installs the devDependencies,
appends the harness block to the existing `.githooks/pre-push`, adds one step
to the existing CI workflow, and verifies by running the sensors once. It never
converts an existing setup — where something is already configured, it reports
and asks.

## The commands (once installed)

```sh
bash scripts/harness.sh check          # both sensors, one report
bash scripts/harness.sh structure      # structural sensor alone (this one gates)
bash scripts/harness.sh complexity     # complexity sensor alone (never fails)
bash scripts/harness.sh install-hook   # wire into the existing pre-push hook
bash scripts/harness.sh status         # what's installed and configured
```

Node projects usually alias these as `npm run harness`, `harness:check`, etc.
`/jgl-check` calls `check` as part of the full verification suite.

## Adapting the rules

**A rule whose `from` matches nothing passes silently, which is worse than no
rule at all.** The shipped `dependency-cruiser.js` assumes `src/lib/` (pure
logic), `src/components/` and `src/pages/` (UI). If this project's logic lives
in `app/core/` and its UI in `app/ui/`, edit the regexes — then confirm the
rule still fires by pointing it at a deliberate violation before you trust it.

`HARNESS_SRC=<dir>` overrides which tree the sensors read; by default the
script takes the first of `src/`, `app/`, `lib/` that exists.
