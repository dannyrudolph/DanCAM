#!/usr/bin/env bash
# PreToolUse guard for Claude Code (optional/agent-guards). Blocks, with a
# reason Claude sees:
#   - reading a plaintext secret file (.env*, except .env.example; *.dec.env,
#     *.dec.yaml, .dev.vars; age keys under ~/.config/sops/age/)   — SEC-2
#   - sops -d / --decrypt, which prints secrets into the transcript  — SEC-2
#   - git push --force / -f / --force-with-lease / +refspec          — jgl-push
#   - --no-verify on push or commit, which skips the git hooks
#   - git add -A / --all / . while secret-shaped files are untracked — SEC-1
#
# Exit 2 blocks the call; exit 0 lets it through. No dependencies: the tool
# input arrives as JSON on stdin and is matched as text, which is enough to
# recognize these patterns without parsing it.
set -u

input=$(cat)
tool=$(printf '%s' "$input" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)"$/\1/')

block() {
  echo "agent-guard: blocked — $1" >&2
  exit 2
}

# .env, .env.local, .env.production …, *.dec.env / *.dec.yaml, .dev.vars.
# .env.example (names only) is stripped before matching, so it always passes.
SECRET_FILE='(^|[^A-Za-z0-9_.-])(\.env(\.[A-Za-z0-9_-]+)?|[A-Za-z0-9_.-]+\.dec\.(env|ya?ml|json)|\.dev\.vars)([^A-Za-z0-9_.-]|$)'
AGE_KEYS='\.config/sops/age/'

mentions_secret_file() {
  printf '%s' "$1" | sed -E 's/\.env\.example//g' | grep -Eq "$SECRET_FILE|$AGE_KEYS"
}

# `git`, then any global options (with an argument, as in `-C dir`), then the
# subcommand.
GIT='(^|[^A-Za-z0-9_-])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+'

case "$tool" in
  Read|Grep)
    target=$(printf '%s' "$input" | grep -oE '"(file_path|path)"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*"([^"]*)"$/\1/' | tr '\n' ' ')
    if mentions_secret_file "$target"; then
      block "$target looks like a plaintext secret file. Work with the variable names in .env.example instead (SEC-2 in AGENTS.md)."
    fi
    ;;
  Bash)
    cmd=$(printf '%s' "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"(\\.|[^"\\])*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
    if printf '%s' "$cmd" | grep -Eq "${GIT}push([[:space:]]|$)"; then
      if printf '%s' "$cmd" | grep -Eq '[[:space:]](--force|--force-with-lease|-f)([[:space:]=]|$)|[[:space:]]\+[^[:space:]]+'; then
        block "force push. If the user really wants it, they can run the exact command themselves."
      fi
      if printf '%s' "$cmd" | grep -Eq '[[:space:]]--no-verify([[:space:]]|$)'; then
        block "push with --no-verify skips the pre-push gate. Fix what the hook reports instead."
      fi
    fi
    if printf '%s' "$cmd" | grep -Eq "${GIT}commit([[:space:]]|$)" && printf '%s' "$cmd" | grep -Eq '[[:space:]](--no-verify|-n)([[:space:]]|$)'; then
      block "commit with --no-verify skips the commit hooks. Fix what the hook reports instead."
    fi
    if printf '%s' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_-])sops([[:space:]]+[^[:space:]]+)*[[:space:]]+(-d|--decrypt)([[:space:]]|$)'; then
      block "sops --decrypt would print secret values into the transcript. Use 'scripts/secrets.sh exec <env> -- <cmd>' to inject them instead."
    fi
    if mentions_secret_file "$cmd"; then
      block "this command touches a plaintext secret file. Work with the variable names in .env.example instead (SEC-2 in AGENTS.md)."
    fi
    if printf '%s' "$cmd" | grep -Eq "${GIT}add[[:space:]]+(-A|--all|\.)([[:space:]]|$)"; then
      secrets=$(git ls-files --others --exclude-standard 2>/dev/null \
        | sed -E 's/\.env\.example$//' \
        | grep -E "$SECRET_FILE|\.(pem|key)$|credentials[^/]*\.json$|service-account[^/]*\.json$" || true)
      if [ -n "$secrets" ]; then
        block "git add would stage secret-shaped untracked files: $(printf '%s' "$secrets" | tr '\n' ' '). Stage files by path instead (SEC-1)."
      fi
    fi
    ;;
esac
exit 0
