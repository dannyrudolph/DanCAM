#!/usr/bin/env bash
# Structural + complexity sensors — stack-agnostic runner.
#
# The kit's steering docs state several structural rules (STRUCT-1 cohesion,
# STRUCT-6 one-way seams, QUAL-3 no dead code) that no test and no type checker
# can observe. This script runs the two tools that can, and reports them the way
# /jgl-check reports everything else: pass, fail, or an explicit skip naming the
# install command. A silent skip is worse than a failure.
#
# TWO SENSORS, TWO SEVERITIES — the split is the whole design:
#
#   structure   dependency-cruiser, .dependency-cruiser.js   FAILS the gate.
#               Cycles, orphans and a src/lib/ that imports UI are structural
#               invariants. They are binary, they do not get gamed, and a
#               human decided them on purpose.
#
#   complexity  eslint, eslint.harness.js                    NEVER fails.
#               Reported as a count, because a hard complexity threshold is
#               satisfied by splitting one honest function into three
#               dishonest ones. Watch the trend across sessions, not any
#               single warning.
#
# Subcommands:
#   check          run both sensors and report (exit 1 only on a structure failure)
#   structure      run the structural sensor alone
#   complexity     run the complexity sensor alone (always exit 0)
#   install-hook   add the harness block to an EXISTING .githooks/pre-push
#   status         list which sensors are installed and configured
#
# Source directory: $HARNESS_SRC, else the first of src/ app/ lib/ that exists.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Locally-installed tools first, then whatever is already on PATH — so a
# devDependency and a global install both work. Note what this deliberately
# does NOT do: shell out to `npx`. npx would silently download a missing tool
# from the network, turning "not installed" into a slow surprise and hiding the
# exact gap the ⊘ lines below exist to report.
PATH="$ROOT/node_modules/.bin:$PATH"

SELF="bash scripts/harness.sh"

DC_CONFIG=".dependency-cruiser.js"
ESLINT_HARNESS="eslint.harness.js"

# Markers delimiting the block install-hook manages inside .githooks/pre-push.
# Re-running replaces what is between them rather than appending a second copy,
# so the hook can be re-provisioned without accumulating duplicates.
MARK_BEGIN="# --- jgl-harness begin (managed by scripts/harness.sh; edit inside) ---"
MARK_END="# --- jgl-harness end ---"

die() { echo "error: $*" >&2; exit 1; }

# Resolve the directory the sensors read. A rule whose `from` matches nothing
# passes silently, so pointing at the wrong tree is a false clean bill of health.
resolve_src() {
  if [[ -n "${HARNESS_SRC:-}" ]]; then
    [[ -d "$HARNESS_SRC" ]] || die "HARNESS_SRC=$HARNESS_SRC is not a directory"
    echo "$HARNESS_SRC"
    return
  fi
  for d in src app lib; do
    [[ -d "$d" ]] && { echo "$d"; return; }
  done
  die "no source directory found (looked for src/ app/ lib/) — set HARNESS_SRC"
}

have() { command -v "$1" >/dev/null 2>&1; }

# --- structural sensor ------------------------------------------------------

structure() {
  if ! have depcruise; then
    echo "⊘ structure   SKIPPED — dependency-cruiser not installed (npm i -D dependency-cruiser)"
    return 2
  fi
  if [[ ! -f "$DC_CONFIG" ]]; then
    echo "⊘ structure   SKIPPED — no $DC_CONFIG (copy it from optional/harness/templates/)"
    return 2
  fi

  local src out status
  src="$(resolve_src)" || return 1
  out="$(depcruise "$src" --config "$DC_CONFIG" --output-type err 2>&1)"
  status=$?

  if [[ $status -eq 0 ]]; then
    echo "✓ structure   dependency-cruiser — no violations in $src/"
    return 0
  fi
  echo "✗ structure   dependency-cruiser — violations in $src/"
  echo "$out" | sed 's/^/    /'
  return 1
}

# --- complexity sensor ------------------------------------------------------
#
# Always returns 0. The count is the signal; the gate is deliberately elsewhere.

complexity() {
  if ! have eslint; then
    echo "⊘ complexity  SKIPPED — eslint not installed (npm i -D eslint)"
    return 0
  fi

  # Prefer the project's own config: if it spreads the harness fragment in, the
  # project's other rules run too, and running the fragment alone would report a
  # different set of findings than the project's real lint does.
  local config
  if [[ -f "eslint.config.js" || -f "eslint.config.mjs" || -f "eslint.config.ts" ]]; then
    config=""
  elif [[ -f "$ESLINT_HARNESS" ]]; then
    config="--config $ESLINT_HARNESS"
  else
    echo "⊘ complexity  SKIPPED — no eslint config (copy $ESLINT_HARNESS from optional/harness/templates/)"
    return 0
  fi

  local src out hits count
  src="$(resolve_src)" || return 0
  # ESLint's default (stylish) output puts the rule id in the last column. The
  # `compact` and `unix` formatters were pulled out of core in ESLint 10 and now
  # need a separate package — parsing the default keeps this dependency-free.
  # shellcheck disable=SC2086
  out="$(eslint "$src" $config 2>&1)"
  hits="$(echo "$out" | grep -E '(complexity|max-depth)[[:space:]]*$' || true)"
  count="$(echo -n "$hits" | grep -c . || true)"

  if [[ "$count" -eq 0 ]]; then
    echo "✓ complexity  eslint — 0 functions over threshold"
  else
    echo "! complexity  eslint — $count over threshold (drift signal, not a gate)"
    echo "$hits" | sed 's/^/    /'
  fi
  return 0
}

# --- pre-push wiring --------------------------------------------------------
#
# Extends the hook /jgl-setup-testing already writes rather than adding a second
# parallel gate. One hook, one place to look, one place to bypass in an
# emergency. Refuses to create the hook: if there is no gate yet, the missing
# piece is the test suite, not the harness.

install_hook() {
  local hook=".githooks/pre-push"
  [[ -f "$hook" ]] || die "$hook does not exist — run /jgl-setup-testing first, then re-run '$SELF install-hook'"

  local existed=0
  if grep -qF "$MARK_BEGIN" "$hook"; then
    existed=1
    # Strip the old block, then re-append a fresh one, rather than substituting
    # in place. Substituting means passing the multi-line block to awk as a -v
    # variable, which BSD/macOS awk rejects outright ("newline in string") while
    # GNU awk accepts — a bug that would pass CI on Linux and break on the
    # customer's Mac. Only the markers cross the awk boundary here, and neither
    # contains a newline.
    local tmp
    tmp="$(mktemp)"
    awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
      $0 == b { skip = 1 }
      !skip   { print }
      $0 == e { skip = 0 }
    ' "$hook" > "$tmp" || { rm -f "$tmp"; die "failed to rewrite $hook"; }
    # Drop trailing blank lines so re-appending is byte-stable: running this
    # twice must leave the file identical, or "idempotent" is only half true.
    printf '%s\n' "$(cat "$tmp")" > "$hook"
    rm -f "$tmp"
  fi

  {
    echo
    echo "$MARK_BEGIN"
    cat <<'BLOCK'
if ! bash scripts/harness.sh structure; then
  echo "pre-push: ✗ structural sensor failed — push aborted." >&2
  exit 1
fi
BLOCK
    echo "$MARK_END"
  } >> "$hook"

  chmod +x "$hook"

  if [[ $existed -eq 1 ]]; then
    echo "✓ $hook — harness block refreshed in place (no duplicate added)"
  else
    echo "✓ $hook — harness block appended"
  fi
}

# --- status -----------------------------------------------------------------

status_report() {
  have depcruise && echo "✓ dependency-cruiser installed" || echo "⊘ dependency-cruiser not installed"
  [[ -f "$DC_CONFIG" ]] && echo "✓ $DC_CONFIG present" || echo "⊘ $DC_CONFIG missing"
  have eslint && echo "✓ eslint installed" || echo "⊘ eslint not installed"
  if [[ -f "eslint.config.js" || -f "eslint.config.mjs" || -f "eslint.config.ts" || -f "$ESLINT_HARNESS" ]]; then
    echo "✓ eslint config present"
  else
    echo "⊘ eslint config missing"
  fi
  if [[ -f ".githooks/pre-push" ]] && grep -qF "$MARK_BEGIN" ".githooks/pre-push"; then
    echo "✓ pre-push hook wired"
  else
    echo "⊘ pre-push hook not wired ($SELF install-hook)"
  fi
}

# --- dispatch ---------------------------------------------------------------

case "${1:-check}" in
  check)
    structure; s=$?
    complexity
    # A skip (2) is a finding the user must act on, but it is not a violation:
    # exit 0 so an unconfigured project can still push, and let the ⊘ line and
    # /jgl-check carry the message.
    [[ $s -eq 1 ]] && exit 1 || exit 0
    ;;
  structure)  structure; [[ $? -eq 1 ]] && exit 1 || exit 0 ;;
  complexity) complexity ;;
  install-hook) install_hook ;;
  status)     status_report ;;
  *) die "unknown subcommand '${1}' (check | structure | complexity | install-hook | status)" ;;
esac
