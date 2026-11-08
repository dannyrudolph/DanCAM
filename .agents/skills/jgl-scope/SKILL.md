---
name: jgl-scope
description: Runs a 15–20 minute guided interview about what you're building, for whom, constraints, brand and stack, then writes docs/SCOPE.md (and docs/BRAND.md when there's a brand), adds a Project context section to AGENTS.md, and picks the first milestone. Use when the user says "/jgl-scope", "help me get started", or "scope this out".
disable-model-invocation: true
---

# Scope — the guided start

A scope document, built as a conversation instead of a blank page.
Interview the user about what they're building, then write it down so
every future session starts oriented instead of guessing.

**This is the greenfield phase 0.** Run it *before* scaffolding — its
answers (stack, solo/team, first milestone) feed the scaffold step in
`/jgl-init`'s greenfield playbook. On an existing project it switches to
update mode (see "Re-running").

**Defer to a domain-specific variant.** If the kit you're in ships its
own onboarding/scoping skill (a Fusion kit's `/jgl-fusion-scope` or
similar), run that instead — it knows the domain's questions. This
skill is the generic fallback for any project.

## Ground rules

- **One question per message.** People answer the first question and hit
  enter; anything stacked after it gets lost, and each answer should shape
  the next question. If your tool has a structured question UI, use it, with
  options where the answers are predictable and free text for the open ones.
  The phase lists below are sequences to walk one turn at a time, skipping
  whatever is already answered.
- **Adapt.** Skip what earlier answers settled; go deeper where the
  answers are vague — vagueness in scoping is where projects die.
- **"I don't know" is a valid answer.** Park it in Open Questions with
  your recommended default in force, and move on.
- **Don't ask for secrets.** No keys, no passwords. If a real one gets
  pasted, stop and walk them through rotating it (SEC-3 in `AGENTS.md`).
- **Target 15–20 minutes.** If they're in a hurry: phases 1, 3, and 4 only.
- **Show before you write.** Present the summary and the file list;
  write only after they confirm.

## The interview

### Phase 1 — the thing

What are you building, in one paragraph as they'd say it to a friend?
Who is it for — themselves, their team, customers, the public? Does
anything like it exist that they like or hate (and why)?

### Phase 2 — the shape

- What kind of thing is it (web app, CLI, service, site, library — infer
  from phase 1 and confirm rather than ask cold)?
- What does it absolutely have to do in version one? What is explicitly
  NOT in version one? (Push for at least two real exclusions — a scope
  with nothing out of scope isn't a scope.)
- Any hard constraints: deadline, budget, devices, offline, existing
  systems it must talk to, data rules (privacy/regulatory)?

### Phase 3 — the pain and the win

What triggered this project — the concrete moment they decided to build
it? What does "this was worth it" look like in three months? That answer
becomes the success criteria and picks the **first milestone**: the
thinnest end-to-end path that touches the pain.

### Phase 4 — the build

- Stack preference? If none, propose one for their situation and skill
  level — one paragraph of why, then confirm. Don't tour the options.
  (This kit's default is TypeScript + Vite + React; see `PRACTICES.md`.)
- Solo or a team? (Shapes git workflow: direct-to-main vs branches+PRs —
  GIT-4 in `AGENTS.md`.)
- How will it run for real — their machine, a host, an app store? (A
  one-line answer is enough at this stage.)

### Phase 5 — the look (skip for CLIs/libraries)

Website, logo, or an app they want it to feel like? If they give a URL
and you have web access, fetch it and extract a palette (hex) and tone;
a logo file in the repo, Read it. Nothing yet? Park it.

## Outputs (after they confirm the summary)

1. **`docs/SCOPE.md`** (or `SCOPE.md` at root if no `docs/`):

   ```markdown
   # Scope — <project>
   _From the /jgl-scope interview, <date>. Update as decisions change._

   ## What this is         <the one-paragraph pitch, their words>
   ## Who it's for         <users + how they reach it>
   ## Version one          <must-dos>
   ## Explicitly not now   <the exclusions, so they stay excluded>
   ## Constraints          <deadline, budget, tech, data rules>
   ## Success criteria     <the three-month "worth it" answer>
   ## First milestone      <thinnest end-to-end path + why this one>
   ## Stack & workflow     <stack, solo/team, where it runs>
   ## Open questions       <every "I don't know", default in force>
   ```

2. **`docs/BRAND.md`** — only if phase 5 produced anything: name,
   palette (hex), tone.

3. **`AGENTS.md` — add a Project context section, don't overwrite.**
   `AGENTS.md` holds the kit's guidelines (how to build); this section says
   *what* is being built. Append it at the end, and keep it lean —
   `docs/SCOPE.md` holds the detail:

   ```markdown
   ## Project context
   _From /jgl-scope on <date>. Detail in docs/SCOPE.md._

   - **What this is:** <one line>
   - **Stack:** <stack>
   - **Workflow:** <solo/main or team/PRs>
   - **First milestone:** <the thinnest end-to-end path>
   ```

   On a re-run, update the existing section in place rather than adding a
   second one.

Then propose the first working session: "milestone one is X — want to
start now?" On a greenfield project that means handing off to the
scaffold step in `/jgl-init`'s greenfield playbook, using the stack and
first-milestone answers you just captured.

## Re-running

`/jgl-scope` on a project that already has a `docs/SCOPE.md` switches to
**update mode**: read it, ask only what changed, revise — never restart
from zero. Stale scope docs are worse than none; suggest a re-run when
the work has clearly drifted from the doc.
