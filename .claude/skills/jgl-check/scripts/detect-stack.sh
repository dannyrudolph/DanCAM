#!/usr/bin/env bash
# Reports which check commands this repo actually has, so /jgl-check runs the
# project's commands instead of guessing. Read-only; run from the repo root.
# Prints key: value lines. Precedence when they disagree: the Commands table
# in AGENTS.md, then what CI runs, then package scripts.
set -euo pipefail

has() { [ -e "$1" ]; }

# --- Package manager (Node) ---
pm=none
if has package.json; then
  pm=npm
  has pnpm-lock.yaml && pm=pnpm
  has yarn.lock && pm=yarn
  { has bun.lockb || has bun.lock; } && pm=bun
fi
echo "package_manager: $pm"

if has package.json; then
  if command -v node >/dev/null 2>&1; then
    node -e '
      const s = require("./package.json").scripts || {};
      const keys = Object.keys(s).filter((k) => /^(test|typecheck|type-check|lint|build|check|test:[\w:-]+)$/.test(k));
      for (const k of keys) console.log(`script: ${k} = ${s[k]}`);
      if (keys.length === 0) console.log("script: (none relevant)");
    '
  else
    echo "script: (node not installed — read package.json directly)"
  fi
  echo "lockfile: $( { has package-lock.json || has pnpm-lock.yaml || has yarn.lock || has bun.lockb || has bun.lock; } && echo yes || echo no)"
fi

# --- Types ---
if has tsconfig.json; then echo "typescript: yes (tsconfig.json)"; else echo "typescript: no"; fi

# --- Python ---
if has pyproject.toml; then
  echo "python: pyproject.toml"
  grep -Eq '^\[tool\.mypy\]' pyproject.toml && echo "python_types: mypy"
  grep -Eq '^\[tool\.pyright\]' pyproject.toml && echo "python_types: pyright"
  grep -Eq '^\[tool\.pytest' pyproject.toml && echo "python_tests: pytest"
elif has requirements.txt || has requirements-dev.txt; then
  echo "python: requirements"
fi

# --- Other ecosystems ---
has Cargo.toml && echo "rust: Cargo.toml"
has go.mod && echo "go: go.mod"
has Gemfile && echo "ruby: Gemfile"

# --- CI: the most reliable record of what actually gates ---
shopt -s nullglob
for wf in .github/workflows/*.yml .github/workflows/*.yaml; do
  grep -E '^[[:space:]]*(-[[:space:]]*)?run:[[:space:]]*[^[:space:]]' "$wf" | sed -E 's/^[[:space:]]*(-[[:space:]]*)?run:[[:space:]]*//' | while IFS= read -r cmd; do
    case "$cmd" in
      "|"*|">"*) cmd="(multi-line script — read the workflow)" ;;
    esac
    echo "ci_run: ${wf#.github/workflows/}: $cmd"
  done
  grep -q 'continue-on-error:[[:space:]]*true' "$wf" && echo "ci_soft_fail: ${wf#.github/workflows/} has continue-on-error: true"
done
for other in .gitlab-ci.yml .circleci/config.yml; do has "$other" && echo "ci_config: $other"; done
shopt -u nullglob

# --- Optional kit modules ---
has scripts/harness.sh && echo "harness: installed" || echo "harness: absent"
{ has scripts/secrets.sh && has .sops.yaml; } && echo "secrets_module: installed" || echo "secrets_module: absent"
has .githooks/pre-push && echo "pre_push_hook: .githooks/pre-push" || echo "pre_push_hook: absent"

# --- AGENTS.md Commands table ---
if has AGENTS.md && grep -q '^| Test |' AGENTS.md; then
  if grep -E '^\| Test \|' AGENTS.md | grep -q 'not set'; then
    echo "agents_md_commands: unset (run /jgl-init)"
  else
    echo "agents_md_commands: set"
  fi
fi
exit 0
