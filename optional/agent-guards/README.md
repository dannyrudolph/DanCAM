# Agent guards (optional)

`AGENTS.md` asks the AI not to read secret files, not to force-push, and not
to skip git hooks. Asking is not the same as preventing: a rule in a text file
is advice the model weighs, and it can lose that weighing late in a long
session. These guards turn the hard "never" rules into checks that run every
time, whatever the model decides.

The `commit-msg` hook in `.githooks/` already covers commit attribution for
every tool. This module covers the rest, for the two tools that support it.

## What it blocks

| Guard | Claude Code | Codex |
|---|---|---|
| Reading `.env`, `.env.*` (not `.env.example`), `*.dec.env`, `*.dec.yaml`, `.dev.vars`, age keys | Read, Grep and shell commands | `cat`/`head`/`tail`/`less` of the common names only |
| `sops -d` / `--decrypt` (prints secrets) | ✓ | ✓ |
| Force push (`--force`, `-f`, `--force-with-lease`, `+branch`) | ✓ anywhere in the command | ✓ only right after `git push` |
| `--no-verify` on push or commit | ✓ | ✓ only right after the subcommand |
| `git add -A` / `.` while a secret-shaped file is untracked | ✓ | — |
| A prompt that contains a live-looking key (Stripe, AWS, GitHub, OpenAI, Anthropic, Slack, Google, age, PEM) | ✓ blocked before it reaches the model | — |
| AI attribution in commits | `attribution` setting turns it off at the source | `commit-msg` hook |
| Pushing at all | — (`AGENTS.md` AUTO-2 asks first) | asks for approval |

Everything is plain bash with no dependencies. Read the scripts before you
install them — they are short on purpose.

## Install — Claude Code

```bash
mkdir -p .claude/hooks
cp optional/agent-guards/hooks/guard-tools.sh optional/agent-guards/hooks/guard-prompt.sh .claude/hooks/
chmod +x .claude/hooks/guard-*.sh
```

Then merge `optional/agent-guards/settings.json` into `.claude/settings.json`.
If you don't have one yet, copy it as is. If you do, add its `attribution`
key and append its `hooks` entries to yours — `/jgl-init` will do the merge
and show you the result. Commit both so everyone on the project gets them.

Check it: start Claude Code and ask it to read `.env`. It should be stopped
with an `agent-guard: blocked` message.

## Install — Codex

```bash
mkdir -p .codex/rules
cp optional/agent-guards/codex/guards.rules .codex/rules/
codex execpolicy check --pretty --rules .codex/rules/guards.rules -- git push -f
```

The last line should report `forbidden`. Project rules load only once you
mark the project as trusted in Codex.

## What this does not cover

- A secret read some other way — a broad `grep -r` over the repo, a script
  that prints its environment, an editor plugin. The guards catch the common
  paths, not every path. SEC-1..5 still matter.
- Key formats not in the list above.
- Other tools (Cursor, Copilot, Antigravity). There, `AGENTS.md` and the git
  hooks are the protection.

A blocked call means the guard is working. If one blocks something legitimate,
run that command yourself, or adjust the pattern in the script — don't delete
the guard.
