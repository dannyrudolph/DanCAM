---
name: jgl-setup-testing
description: Installs a test framework where none exists, writes a real starter test, and wires coverage, CI, and a pre-push hook. Use when the user says "set up testing" or "/jgl-setup-testing", or when /jgl-check reports no test framework.
disable-model-invocation: true
---

# Setup Testing

Bootstrap a test framework on a project that doesn't have one — or that
has a half-configured setup. The goal is to leave the project with: a
test command that actually runs, at least one **real** test (not a
smoke test), coverage tooling configured, and CI that runs both on every
PR.

## 1. Detect or ask which framework

Inspect the project before suggesting anything:

- **Has `vite.config.*` or uses Vite?** → **Vitest**. Same transform
  pipeline, native ESM, fast.
- **Next.js project (`next.config.*`)?** → **Vitest** for a new setup (Next
  documents both Vitest and Jest; keep Jest if it's already there). Async
  Server Components weren't unit-testable in either as of Next.js 16 (2026) —
  cover those with Playwright E2E, and recheck the Next.js testing docs.
- **React Native?** → **Jest**.
- **Plain Node library, no DOM?** → **Vitest** (or `node:test` if the
  user wants zero dependencies).
- **Python with `pyproject.toml`?** → **pytest** with **pytest-cov**.
- **Anything else** → ask the user. Don't guess.

State your detection and ask the user to confirm before installing
anything: *"This looks like a Vite + React project, so I'll set up
Vitest with `@vitest/coverage-v8`. OK?"*

## 2. Install

For Vitest on a Vite project:

```bash
npm install -D vitest @vitest/coverage-v8 jsdom
```

For Jest (React Native, or a project already on Jest):

```bash
npm install -D jest @types/jest @testing-library/react @testing-library/jest-dom jest-environment-jsdom
```

For pytest:

```bash
pip install pytest pytest-cov
# or, if the project uses requirements-dev.txt:
echo "pytest" >> requirements-dev.txt
echo "pytest-cov" >> requirements-dev.txt
```

Pin versions if the project pins everything else (`^` for Node, `==` for
Python with locked requirements).

## 3. Configure

Write the minimum config needed. For Vitest:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/data/**'],
      reportsDirectory: './coverage',
    },
  },
});
```

For Jest, write a minimal `jest.config.js` (on Next.js, use the `next/jest` preset).

For pytest, add `[tool.pytest.ini_options]` to `pyproject.toml` with
`testpaths` and `addopts = "--cov=<package>"`.

**Keep the config minimal.** Don't add 30 options the user doesn't
understand yet. The TESTING-PIPELINE.md reference doc covers the full
Vite stack including monocart + Playwright; point the user there once
the basics are working.

## 4. Write a **real** starter test

The default Vitest/Jest/pytest scaffold often produces `expect(1 +
1).toBe(2)` or similar. **Don't ship that.** Pick a small piece of real
logic in the user's codebase and write a tight test for it.

- For an empty greenfield project, write a `src/lib/<thing>.ts` with one
  real function plus its test.
- For an existing project, look for a small pure function (a formatter,
  a parser, a calculator) and write a test that asserts on a specific
  computed value. Cover sizes 0/1/N where it makes sense.

A real test looks like:

```ts
import { describe, it, expect } from 'vitest';
import { formatCurrency } from './currency';

describe('formatCurrency', () => {
  it('formats integer dollars with no decimal', () => {
    expect(formatCurrency(42, 'USD')).toBe('$42');
  });
  it('formats fractional dollars with two decimals', () => {
    expect(formatCurrency(42.5, 'USD')).toBe('$42.50');
  });
  it('handles zero', () => {
    expect(formatCurrency(0, 'USD')).toBe('$0');
  });
});
```

Not:

```ts
it('formatCurrency exists', () => {
  expect(formatCurrency).toBeDefined(); // catches almost nothing
});
```

The starter test is *the template* the user will copy. Make it good.

## 5. Wire scripts in `package.json` (or `pyproject.toml`)

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

Don't replace existing scripts; add what's missing.

## 6. Wire CI

If `.github/workflows/` doesn't have a test workflow, write one. Keep it
short. For a Node project:

```yaml
name: Tests
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm audit --audit-level=moderate
      - run: npx tsc -b
      - run: npm run test:coverage
```

If a workflow file already exists, **don't overwrite it.** Tell the user
what change you'd make and let them decide.

## 7. Add a pre-push hook

CI catching a red suite *after* the push is too late — and a push can
trigger a deploy. Add a version-controlled pre-push hook that runs the same
fast gate locally and aborts the push on failure. Write `.githooks/pre-push`
(this is the Node/Vitest shape; for a Python project drop the `tsc` line and
use `pytest` in place of `npm test`):

```bash
#!/usr/bin/env bash
#
# pre-push hook — block a push when the gate CI runs would fail.
# Mirrors CI's fast gate: type check + the unit suite. Coverage and E2E are
# intentionally skipped here — they only add wall-clock; a failing assertion
# fails the same without them.
#
# Emergency bypass:  git push --no-verify
set -euo pipefail

echo "pre-push: typecheck + tests …"

if ! npx tsc -b; then
  echo "pre-push: ✗ typecheck failed — push aborted." >&2
  exit 1
fi

if ! npm test; then
  echo "pre-push: ✗ tests failed — push aborted." >&2
  exit 1
fi

echo "pre-push: ✓ typecheck + tests passed."
```

Then make it executable and point git at the version-controlled hooks path
(once per clone — the user re-runs the `config` line on any other clone):

```bash
chmod +x .githooks/pre-push
git config core.hooksPath .githooks
```

If `.githooks/pre-push` already exists, **don't overwrite it** — show the
user the change you'd make and let them decide.

If `core.hooksPath` is already set to something other than `.githooks`
(Husky's `.husky/`, lefthook, the pre-commit framework), don't repoint it —
that would switch off the hooks the repo already relies on. Show the user the
lines to add to their existing setup instead.

## 8. Verify

Run the test command once to confirm everything works. Show the user
the output. If anything fails, fix it in the same session — don't leave
the project in a half-configured state.

## 9. Record the commands

Fill the Test (and Type check, if you wired one) rows of the Commands table
in `AGENTS.md` with the commands you just set up, so every later session runs
the same ones.

## 10. Report

```
✓ Vitest + @vitest/coverage-v8 installed
✓ vitest.config.ts written
✓ src/lib/currency.test.ts written (3 tests, all passing)
✓ test, test:watch, test:coverage scripts added
✓ .github/workflows/test.yml written
✓ .githooks/pre-push written + chmod +x; core.hooksPath set to .githooks
✓ AGENTS.md Commands table: Test = npm test, Type check = npx tsc -b

Next: `npm run test:coverage` and `/jgl-review-testing` once you have
more code to cover.
```
