---
name: jgl-setup-harness
description: Installs the structural and complexity sensors (dependency-cruiser and ESLint complexity rules), proves each structural rule fires, and wires them into the existing pre-push hook and CI. Use when the user says "set up the harness", "/jgl-setup-harness", "add architecture linting", or "check for circular dependencies".
disable-model-invocation: true
---

# Setup Harness

Install the **sensors** described in `ARCHITECTURE.md`: the checks that observe
the codebase's shape after a change, rather than steering it beforehand. The
kit's steering docs already state the rules (STRUCT-1 cohesion, STRUCT-6
one-way seams, QUAL-3 no dead code); nothing enforced them until now.

Run this **after** `/jgl-setup-testing` — this skill extends the pre-push hook
and CI workflow that skill writes rather than creating a second parallel gate.

Everything installed comes from `optional/harness/`. Read
`optional/harness/README.md` before starting; it explains why the structural
sensor gates and the complexity sensor deliberately doesn't.

## 1. Audit before installing anything

Brownfield repos usually have *some* of this already. Find out what, and report
it, before proposing a change. Check for:

- `.dependency-cruiser.js` / `.dependency-cruiser.json` / a `depcruise` key in
  `package.json` — an existing structural config.
- `eslint.config.js` (flat) or `.eslintrc.*` (legacy) — an existing lint setup,
  and whether `complexity` or `max-depth` are already set.
- `dependency-cruiser` / `eslint` in `devDependencies`.
- `.githooks/pre-push` and `core.hooksPath` — the gate this wires into.
- `.github/workflows/*.yml` — which workflow is the real PR gate.
- Any *other* architecture linter already in play (`eslint-plugin-boundaries`,
  Nx module boundaries, `madge`, a custom script). **If one exists, stop and
  report it.** Two structural linters disagreeing is worse than one.

Report what you found, then say what you'd install. **Wait for confirmation.**

```
Found:
  ✓ .githooks/pre-push (typecheck + tests), core.hooksPath set
  ✓ eslint.config.js — flat config, no complexity/max-depth rules
  ✗ no structural linter
  ✗ dependency-cruiser not in devDependencies

Proposed:
  + npm i -D dependency-cruiser
  + .dependency-cruiser.js (adapted: logic in src/lib/, UI in src/components/)
  + eslint.harness.js, spread into the existing eslint.config.js
  + scripts/harness.sh
  + harness block appended to .githooks/pre-push
  + one step added to .github/workflows/test.yml

Nothing existing gets overwritten. OK?
```

## 2. Install the dependencies

```sh
npm install -D dependency-cruiser eslint
```

Skip either one that's already present. If the project isn't Node, say so
plainly — this module is Node-only, and the honest answer is that the
structural sensor doesn't transfer. (Python's nearest equivalents are
`import-linter` and `ruff`'s `C901`; naming them is more useful than
pretending.)

## 3. Copy the runner and configs

```sh
cp optional/harness/scripts/harness.sh scripts/harness.sh
cp optional/harness/templates/dependency-cruiser.js .dependency-cruiser.js
cp optional/harness/templates/eslint.harness.js eslint.harness.js
```

**Then adapt `.dependency-cruiser.js` to this repo's actual layout.** This is
the step that matters most and the one easiest to skip: the shipped config
assumes `src/lib/` for pure logic and `src/components/` + `src/pages/` for UI.
A `from` regex that matches nothing reports a clean bill of health forever.

Read the repo's tree, decide which directory holds pure logic and which hold
UI, and rewrite the `lib-is-a-leaf` rule's paths accordingly. If the project
genuinely has no such split yet, **delete that rule** rather than shipping one
that can never fire — and say you deleted it.

If the project already has `eslint.config.js`, don't replace it. Spread the
fragment in:

```js
import harness from "./eslint.harness.js";
export default [
  ...harness,
  // the project's existing config, unchanged
];
```

For a legacy `.eslintrc.*` project, add the two rules directly to its `rules`
block instead and delete `eslint.harness.js` — a flat-config fragment does
nothing there.

## 4. Prove each rule fires before trusting it

This is the step that makes the rest trustworthy: a structural config that
matches nothing looks exactly like a clean codebase.

For each rule you kept, create a temporary violation, confirm the sensor
reports it, then delete the violation:

```sh
# lib-is-a-leaf: a logic file importing UI
echo 'import { X } from "../components/X";' > src/lib/__probe.ts
bash scripts/harness.sh structure     # must report lib-is-a-leaf
rm src/lib/__probe.ts
```

Do the same for `no-circular` (two files importing each other) and
`no-orphans` (a file nothing imports and that imports nothing). Report which
rules you confirmed. If one *can't* be made to fire, that rule is misconfigured
— fix it or remove it; don't leave it in.

## 5. Wire the pre-push hook

```sh
bash scripts/harness.sh install-hook
```

This appends a marked block to the **existing** `.githooks/pre-push`. It
refuses to run if that file doesn't exist — the fix then is `/jgl-setup-testing`
first, not a second hook. Re-running it replaces the block in place rather than
appending a duplicate, so it's safe to re-provision.

Only the **structural** sensor goes in the hook. Complexity warnings must never
block a push (see `optional/harness/README.md`).

## 6. Wire CI

Add one step to the workflow that already gates PRs — don't write a new
workflow. After the type-check step:

```yaml
      - run: bash scripts/harness.sh check
```

`check` exits non-zero only on a structural violation; complexity warnings are
printed and ignored. If the workflow doesn't exist, `/jgl-setup-testing` §6
owns creating it — run that first.

## 7. Add convenience scripts

```json
{
  "scripts": {
    "harness": "bash scripts/harness.sh check",
    "harness:status": "bash scripts/harness.sh status"
  }
}
```

Don't replace existing scripts; add what's missing.

## 8. Verify

Run `bash scripts/harness.sh check` once and show the output. A repo that has
never had a structural linter will usually surface real findings on the first
run — orphan modules especially. **Don't fix them silently and don't weaken the
config to make them go away.** Report them and let the user decide: each one is
either dead code to delete or a legitimate entry point to add to the allow-list.

If the first run is very noisy (more than a handful of findings), that's a
finding in itself — say so, and offer to work through them as a separate task
rather than burying them in this one.

## 9. Report

```
✓ dependency-cruiser + eslint installed
✓ .dependency-cruiser.js written (lib-is-a-leaf adapted: src/lib/ → src/ui/)
✓ eslint.harness.js written and spread into eslint.config.js
✓ scripts/harness.sh copied
✓ rules confirmed to fire: no-circular, no-orphans, lib-is-a-leaf
✓ .githooks/pre-push — harness block appended
✓ .github/workflows/test.yml — harness step added after typecheck
✓ harness, harness:status scripts added

First run: 3 findings
  ✗ no-orphans: src/lib/legacy-format.ts, src/lib/old-parser.ts
  ✗ no-circular: src/lib/auth.ts ↔ src/lib/session.ts

Those are real. The two orphans look like dead code; the cycle between auth
and session is a genuine coupling problem. Want me to take them on next?
```

Then point the user at `/jgl-check`, which now reports these alongside types
and tests.
