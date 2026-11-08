---
name: jgl-status
description: Gives a short, read-only session checkpoint — what's committed, staged, and in progress, what's still open, anything risky left uncommitted, and whether enough has been generated since the last commit to checkpoint. Use when the user says "status", "/jgl-status", "where are we", or before committing on a long session.
---

# Status

A checkpoint the user can read in under a minute: what's done, what's left,
what's at risk. This skill only reads — mention anything that needs fixing
as a finding and leave the files alone.

## What changed

From `git status`, `git diff --stat`, and `git log @{u}..HEAD --oneline` (or
against `origin/<default>` with no upstream), count three buckets: committed
but not pushed, staged, and unstaged or untracked. Name the files when there
are a few; summarize by directory when there are many.

## Session volume (GIT-5)

Run `scripts/session-volume.sh` from this skill's folder
(`.claude/skills/jgl-status/` or `.agents/skills/jgl-status/`). It reports
files changed and lines added since the last commit, untracked files
included, and whether that crosses the checkpoint line (10 files / 400
lines; `FILES_LIMIT` / `LINES_LIMIT` override it for repos whose normal
change is smaller).

If it says `checkpoint: yes`, recommend `/jgl-commit` in one line — it also
refreshes `docs/PROGRESS.md` for the next session. Volume is the measured
driver of drift, not time (`ARCHITECTURE.md`, "Session length"). Uncommitted
work older than about two hours is a weaker hint worth one line too; if only
the clock trigger fires, say which one it was.

## What's still open

Only report what you find:

- Failing tests, if the project has a quick test command (Commands table in
  `AGENTS.md`).
- New `TODO` / `FIXME` / `XXX` markers and new `.skip` / `xit` /
  `@pytest.mark.skip` in this session's diff.
- On a feature branch, note it may still need a PR (you can't check the host
  without its CLI).

If nothing turns up, say "Nothing flagged."

## Anything risky uncommitted

- Secret-shaped files modified or untracked (`.env*`, `*.key`, `credentials*`,
  and decrypted `*.dec.env` from the secrets module — those should be
  re-encrypted or cleaned, not left on disk).
- Dependency manifest or lockfile changes — tests should be re-run after an
  install.

## Report

```
Status — feature/login-form (no PR yet)

Committed, not pushed:  3 commits
Staged:                 0 files
Unstaged:               2 files (src/lib/auth.ts, src/pages/login.astro)

Session:  ! 14 files / ~520 added lines since the last commit — checkpoint
            with /jgl-commit before the next chunk of work

Open:
  • 1 new TODO in src/lib/auth.ts:88 ("revisit token refresh")
  • No tests yet for the new validators in src/lib/

Risky:
  • .env modified but not staged (good — keep it that way)

Next steps you might consider:
  • /jgl-commit
  • Add tests for the validators (/jgl-review-testing)
```

End with two or three suggested next steps — suggestions; the user picks.
