---
name: jgl-init
description: Sets up a repo that just received this kit — works out greenfield vs brownfield, merges any existing AGENTS.md/CLAUDE.md, fills in the Commands table, installs the commit-msg hook, offers the agent guards, then runs the matching greenfield or brownfield playbook. Use when the user says "init", "/jgl-init", "I just added the kit", or "get set up". Run once per project.
disable-model-invocation: true
---

# Init — first run in a project

A once-per-project orientation. Later sessions just read `AGENTS.md` and get
to work. `/jgl-init` orients and sets up; it doesn't start feature work.

## 1. Greenfield or brownfield

Decide which before touching anything — treating an existing repo as empty is
how files get overwritten.

- **Greenfield:** no `package.json` / `pyproject.toml` / equivalent, no
  source beyond placeholders, at most an initial commit (the kit's own files
  don't count).
- **Brownfield:** existing source, dependencies, and history.

## 2. Merge an existing rules file

If the repo had its own `AGENTS.md` or `CLAUDE.md` before the kit arrived
(look for `AGENTS.kit.md`, which the README tells users to copy the kit's file
in as, or check `git log` for who wrote the current one), don't overwrite it.
Propose a merged `AGENTS.md`: the repo's own project-specific rules first, then
the kit's sections that don't conflict, and list every conflict for the user to
decide. Keep the result under ~150 lines. If the repo's rules lived in
`CLAUDE.md`, move them into `AGENTS.md` and leave `CLAUDE.md` as `@AGENTS.md`
plus anything Claude-specific, so every tool reads the same rules. Write it
only after the user approves.

## 3. Fill in the Commands table

`AGENTS.md` ships with a Commands table that says "not set yet". Fill it from
what the repo actually runs — `scripts/detect-stack.sh` in the `jgl-check`
skill folder prints the scripts and CI commands. Prefer what CI runs. Leave a
row as "none" when the project has no such step. In a greenfield repo, do
this after scaffolding instead.

## 4. Git hooks

Point git at the kit's version-controlled hooks and confirm the `commit-msg`
hook (it rejects AI attribution, GIT-1) is executable:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/commit-msg
```

If `core.hooksPath` already points somewhere else (Husky's `.husky/`,
lefthook, pre-commit), don't repoint it. Show the user the two lines from
`.githooks/commit-msg` that would need adding to their existing setup instead.

## 5. Agent guards (Claude Code)

`optional/agent-guards/` holds Claude Code settings and hooks that block
reading secret files, force pushes, `--no-verify`, and pasted keys before they
reach the model — the cases the prose rules in `AGENTS.md` can't stop on their
own. Offer to install it (its README has the steps); don't install without a
yes. Prefer it over a third-party plugin: it's short enough to read in full,
and it never sends prompts anywhere. In other tools, say these guards don't
apply and the `AGENTS.md` rules plus the git hooks are the protection.

## 6. Skills are where this tool reads them

The kit ships skills in `.claude/skills/` (Claude Code) and `.agents/skills/`
(Codex, Antigravity, Cursor, Copilot, Devin). If this tool can't see them,
check the other folder and offer to copy them where it reads. In a surface
that can't run skills at all, read the relevant `SKILL.md` and follow it.

## 7a. Greenfield playbook

1. If there's no `docs/SCOPE.md`, start with `/jgl-scope` (or follow its
   `SKILL.md`) unless the user has already settled what, for whom, the stack,
   and the first milestone.
2. Scaffold the stack the scope settled (the kit's default is TypeScript +
   Vite + React — confirm before assuming).
3. Wire testing before the first feature, with at least one real test
   (`/jgl-setup-testing`), then CI.
4. Fill in the Commands table (step 3).
5. Mention `/jgl-setup-secrets` if the project will hold keys.
6. First commit with `/jgl-commit`.

## 7b. Brownfield playbook

Bring the kit's principles in alongside the repo's conventions; don't convert
the project to the kit's defaults.

1. **Audit without changing code.** Report what already fits the `AGENTS.md`
   rules, what's borderline, and what would need to change. The Commands
   table, hooks, and guards above are the only edits on this pass.
2. **Map the stack** — test framework, CI provider, build, type checker — so
   the user can confirm you read it right. From here on, every `/jgl-*` skill
   uses the project's commands.
3. **Inventory the gates** — what each CI workflow and hook runs. Repos often
   have a fast PR gate and a wider deploy gate; both are legitimate.
4. **Flag clashes as findings:** plaintext secrets, weak assertions, a test
   job that can't fail the build, no dependency audit.
5. Ask what to work on next.

## Report

```
Project shape: brownfield (history since 2024, Vitest + GitHub Actions)
Rules: AGENTS.md — Commands table filled (npm test, npx tsc -b, npm run build)
Hooks: core.hooksPath = .githooks; commit-msg active
Agent guards: offered — not installed yet
Skills: .claude/skills/ — correct for this tool
Audit: 4 findings (2 secrets, 1 weak-assertion cluster, 1 soft-failing CI job)
Next: pick a finding, or run /jgl-review-testing for depth.
```
