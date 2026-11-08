---
name: jgl-push
description: Pushes committed work to the remote, asking first before any push to main, master, or a production branch, and never forcing or skipping hooks. Use when the user says "push", "/jgl-push", or "send it up".
disable-model-invocation: true
---

# Push

Push committed work to the remote. Pushing can trigger CI and deploys and
makes work public on shared repos, which is why it's a separate step from
`/jgl-commit` (GIT-2).

## Before pushing

Show the user what's going out: the current branch and the commits ahead of
the remote (`git log @{u}..HEAD --oneline`, or against `origin/<default>` when
there's no upstream). If nothing is ahead, say so and stop.

## Branch rules

- **Feature branch** (anything but `main`, `master`, `production`, `release`):
  push. Use `git push -u origin <branch>` the first time.
- **`main`, `master`, or a production branch:** ask first and wait for a clear
  yes. Silence or ambiguity is a no. Offer the safer path in the same message:

  ```
  You're about to push 3 commits to origin/main.
  If this is a production app, the safer flow is a feature branch and a PR:
      git checkout -b <feature-branch> && git push -u origin <feature-branch>
  Push directly to main? (yes/no)
  ```

  A yes covers the rest of this session only; ask again next session.

## Pushing

Let the pre-push hook run — it re-runs the type check and tests and stops a
red push. Don't use `--no-verify` to get past it.

If the push is rejected as non-fast-forward, don't force it. Tell the user the
remote has commits they don't have, suggest `git pull --rebase`, and let them
decide. Use `--force` / `--force-with-lease` only when the user explicitly
asks and has confirmed what it overwrites. Push only the branch that's
checked out or the one the user named — if unsure which, ask.

## Report

```
Pushed 3 commits to origin/feature/login-form.
https://github.com/<owner>/<repo>/tree/feature/login-form
```

Derive the URL from `git remote get-url origin` when you can, so the user can
open the PR or watch CI.
