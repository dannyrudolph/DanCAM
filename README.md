# Bootstrap Folder

Drop this folder into a project — new or existing — to add project
guidelines and skills your AI coding tool will pick up automatically.

- **New project?** Copy the whole folder into a fresh directory and ask
  your AI to scaffold (see "Starting fresh" below).
- **Existing project?** Copy the same files into your repo and ask your
  AI to audit the codebase against the new guidelines before changing
  anything (see "Joining an existing project" below).

## What's included

**Guidelines** — one file, `AGENTS.md`, that your AI reads automatically.
It holds this project's commands, what "done" means, what the AI may do
without asking, and the rules agents get wrong without being told. Codex,
Cursor, GitHub Copilot, Antigravity, Devin and most other tools read
`AGENTS.md` directly. Claude Code reads `CLAUDE.md`, which imports
`AGENTS.md` and adds a few Claude-specific notes — so edit `AGENTS.md`, and
every tool sees the change.

Still on the enterprise Gemini CLI? Point it at the same file by adding
`"context": { "fileName": ["AGENTS.md"] }` to `.gemini/settings.json`.

**Reference docs** — not loaded into every chat; `AGENTS.md` tells your AI
which one to read for which task:

- `ARCHITECTURE.md` — which checks block a push, which only signal, and why
- `PRACTICES.md` — dependencies, refactoring, coverage, CI, type safety,
  verification, code quality
- `TESTING-PIPELINE.md` — the full Vitest + Playwright + coverage setup
- `SECRETS-PIPELINE.md` — the SOPS + age runbook and the leaked-secret
  rotation procedure
- `optional/harness/README.md` — the structural + complexity checks, and why
  one of them blocks a push and the other never does

**Guards** — checks that run every time, whatever the AI decides:

- `.githooks/commit-msg` — rejects AI attribution in commit messages, for
  every tool. `/jgl-init` switches it on.
- `optional/agent-guards/` — Claude Code hooks and Codex rules that block
  reading secret files, force pushes, `--no-verify`, and prompts containing a
  live key. Opt in through `/jgl-init` or its README.

**Skills** — reusable commands you can type in your AI tool's chat:

| Command | What it does |
|---------|-------------|
| `/jgl-init` | First run in a project. Works out greenfield vs brownfield, merges any rules file the repo already had, fills in the Commands table in `AGENTS.md`, switches on the commit-msg hook, offers the agent guards, then runs the matching playbook (scaffold, or audit-before-changing). Run once per project. |
| `/jgl-scope` | Guided-start interview (~15–20 min, one question at a time) for a new project. Writes `docs/SCOPE.md`, an optional `docs/BRAND.md`, adds a Project context section to `AGENTS.md`, and picks the first milestone. Run it before scaffolding. |
| `/jgl-check` | Run every check — tests, type check, build, dependency audit, structure, complexity — grouped into the ones that block a push and the ones that are only a signal. Reports pass / fail / SKIPPED honestly for each. |
| `/jgl-setup-testing` | Wire up a test framework on a project that doesn't have one. Detects stack, installs, writes a real starter test, sets up CI, and adds a pre-push hook that runs the suite before every push. |
| `/jgl-setup-secrets` | **Optional.** Set up encrypted-in-repo secrets (SOPS + age): separate dev/prod keys, verified key rotation, a keyless manifest check, and a pre-commit guard. Requires the `sops` and `age` CLIs. Opt in by running it; opt out by deleting `optional/secrets/`. |
| `/jgl-setup-harness` | **Optional.** Install the checks that watch your codebase's shape: `dependency-cruiser` for circular dependencies, dead modules and layer violations (this one blocks a push), plus ESLint complexity warnings (this one never does). Extends the pre-push hook and CI `/jgl-setup-testing` already wrote. Opt out by deleting `optional/harness/`. |
| `/jgl-review-code` | Review code for structural issues. Produces a refactor plan if needed. |
| `/jgl-review-testing` | Audit test quality. Produces a testing improvement plan if needed. Designed to run in 2–3 passes on a low-test codebase. |
| `/jgl-status` | Session checkpoint — what changed, what's open, anything risky uncommitted. Read-only. |
| `/jgl-commit` | Stage and commit changes locally with a meaningful message. **Does not push.** On a long session it also updates `docs/PROGRESS.md` so a fresh session can pick up. |
| `/jgl-push` | Push to remote. Asks before pushing directly to `main` / `master`. |

## Where skills work

The skills ship twice: under `.claude/skills/` for Claude Code, and under
`.agents/skills/`, the Agent Skills open standard that Codex, Antigravity,
Cursor, GitHub Copilot and Devin read. Keep both — they're small, and deleting
the wrong one hides the skills from your tool.

Skills run inside the local agent of each tool. You start one by typing its
name — `/jgl-check` in most tools, `$jgl-check` in Codex — or the AI picks
one up when your request matches it. Skills that change things
(`/jgl-commit`, `/jgl-push`, `/jgl-init`, `/jgl-scope`, the setup skills) are
marked so Claude Code and Codex run them only when you type them.

In a surface that can't run skills (a chat window with no access to your
files), ask the AI to read the matching `SKILL.md` and follow it — they're
playbooks, not magic. Uploading a skill to claude.ai? It accepts only the
standard frontmatter fields (`name`, `description`, `license`,
`compatibility`, `metadata`, `allowed-tools`), so delete the other lines from
the top of the file first.

## Model notes

The kit's files are written to work across models and tools without tuning.
What you set in your tool matters more than anything the kit could say:

- **Effort / reasoning level** is the main dial. Higher for big features and
  reviews, lower for small edits — it changes behavior more reliably than
  wording in a rules file does.
- **Let the agent run the checks.** `AGENTS.md` tells it running tests and the
  type check is safe without asking; your tool's permission mode decides
  whether it actually can.

## Starting fresh

```bash
# Copy this folder and rename it
cp -r bootstrap/ ~/my-project
cd ~/my-project

# Open in VS Code
code .
```

Then tell your AI coding tool:

> "Run /jgl-init"

It'll confirm the project is empty, then walk the greenfield playbook —
scoping interview, stack, scaffold, tests, CI, first commit.

## Joining an existing project

Copy the kit's files into your existing repo (you can drop them at the
root; the `.claude/` and `.agents/` directories sit alongside whatever's
already there). If the repo already has its own `AGENTS.md` or `CLAUDE.md`,
don't overwrite it: copy the kit's `AGENTS.md` in as `AGENTS.kit.md` and
`/jgl-init` will merge the two with you.

Then tell your AI:

> "Run /jgl-init"

(Or, if your tool doesn't do slash commands: "Read `AGENTS.md`, then audit
this codebase against its rules. Tell me what already fits, what's
borderline, and what would need to change. Don't change anything yet — just
the audit.")

The guidelines are written to handle this path. The AI will detect that
the project has history, map your existing stack (Jest, Vitest, pytest,
whatever), identify the CI gates that already exist, and report findings
without trying to convert the project to the kit's defaults. From there,
work through the findings at your pace.

## Using the skills

Type the command directly in your AI tool's chat:

```
/jgl-check
```

Runs every check and groups them by whether a failure blocks a push:

```
Gates — a failure here blocks the push
  ✓ audit       npm audit — no vulnerabilities
  ✓ types       tsc — no type errors
  ✓ tests       12 passed, 0 failed
  ✓ structure   dependency-cruiser — no violations

Drift signals — watch the trend, don't gate on the number
  ! complexity  eslint — 2 functions over threshold

  ⊘ build       SKIPPED — no build script
```

```
/jgl-commit
```

Stages and commits locally — **does not push**:

```
Committed locally: "add user signup form with validation"
3 files changed.

Push when you're ready: /jgl-push
```

```
/jgl-push
```

Pushes to the remote. Asks before pushing directly to `main`/`master`:

```
You're about to push 3 commits to origin/main. If this is a production
app, the safer flow is a feature branch and a pull request. Continue? (yes/no)
```

```
/jgl-review-testing
```

Audits test quality and plans improvements:

```
Coverage: 72% overall. Core logic at 51%.
Findings:
  - src/lib/auth.ts: no tests
  - src/lib/validation.ts: assertions only check toBeDefined()
Testing plan:
  1. Do first: add tests for auth.ts — login, signup, token refresh
  2. Do first: replace weak assertions in validation.test.ts
```

```
/jgl-review-code
```

Reviews code structure and plans refactors:

```
Findings:
  - src/pages/Dashboard.tsx: 380 lines, mixed data fetching and rendering
  - formatDate() duplicated in 4 files
Refactor plan:
  1. Do first: extract formatDate into lib/dates.ts
  2. Do second: split Dashboard into DashboardPage + DashboardChart + useDashboardData
```

**Tip:** Always run `/jgl-review-testing` before `/jgl-review-code` — build the safety net
before rearranging the code.
