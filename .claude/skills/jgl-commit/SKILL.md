---
name: jgl-commit
description: Stages the relevant changes and makes a local commit with a specific message and no AI attribution; never pushes. On a long session it also refreshes docs/PROGRESS.md so the next session can pick up. Use when the user says "commit", "/jgl-commit", "save my work", or "checkpoint".
disable-model-invocation: true
---

# Commit

Make one local commit of the work in progress. This skill never pushes —
pushing can trigger CI, deploys, and public visibility, so it's a separate,
deliberate step (`/jgl-push`, GIT-2). If the user said "commit and push",
commit, then tell them pushing is `/jgl-push` and do it only if they confirm.

## Stage

Look at `git status` and `git diff` so you know what's being committed. If
nothing changed, say so and stop — no empty commits.

Stage specific paths, not `git add -A` / `git add .`. Leave secret-shaped
files out even if the user said "commit everything": `.env` and its variants,
`*.dec.*`, `credentials*.json`, `service-account*.json`, `*.pem`, `*.key`,
`id_rsa*`. Tell the user which ones you skipped. If they insist on one,
warn that it stays in git history for good and that any real key in it should
be rotated (SEC-1, SEC-3).

## Write the message

A subject under ~72 characters saying what changed — "add login form with
email validation", not "update files". Add a short body only when the subject
can't carry something the reader needs.

No AI attribution (GIT-1): no `Co-Authored-By` naming an AI tool or model, no
"Generated with" line, no 🤖. Your tool may add one by default; leave it off.
If the repo has the kit's `commit-msg` hook, it rejects them anyway.

Commit with a heredoc so formatting survives:

```bash
git commit -m "$(cat <<'EOF'
<subject>

<optional body>
EOF
)"
```

If a hook rejects the commit, fix what it found and commit again. Don't use
`--no-verify`; if the hook itself is broken, say so.

## Hand off on a long session (GIT-5)

Run `scripts/session-volume.sh` from the `jgl-status` skill folder
(`.claude/skills/jgl-status/` or `.agents/skills/jgl-status/`) *before*
committing. If it reported `checkpoint: yes`, update `docs/PROGRESS.md`
(create it if needed, keep it under ~30 lines) and include it in the commit:

```markdown
# Progress
_Updated <date>._

## Done
## In flight
## Next step
## Open questions
```

Rewrite the sections rather than appending, so the file stays a snapshot. Then
suggest continuing in a fresh session that starts from `docs/PROGRESS.md` and
`git log`.

## Report

```
Committed locally: "add login form with email validation"
3 files changed. Skipped: .env (secret-shaped)

Push when you're ready: /jgl-push
```
