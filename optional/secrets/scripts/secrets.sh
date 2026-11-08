#!/usr/bin/env bash
# SOPS + age secret management — stack-agnostic.
#
# The single source of truth for every secret is an ENCRYPTED file committed to
# the repo: secrets/dev.enc.env (local/sandbox) and secrets/prod.enc.env
# (production). They are encrypted with SOPS + age.
#
# SEPARATE KEYS PER ENVIRONMENT. dev and prod are encrypted to DIFFERENT age
# recipients, so the two files require DIFFERENT private keys to decrypt:
#   ~/.config/sops/age/<project>-dev.txt   decrypts ONLY secrets/dev.enc.env
#   ~/.config/sops/age/<project>-prod.txt  decrypts ONLY secrets/prod.enc.env
# A developer holds the dev key; the owner holds both; CI holds only the prod
# key (e.g. GitHub Actions secret SOPS_AGE_KEY_PROD). A leaked dev key exposes
# zero production secrets. The age PUBLIC recipients live in .sops.yaml (safe to
# commit); the private keys never enter the repo.
#
# PROJECT NAME (key filename prefix) is resolved in this order:
#   1. $SECRETS_PROJECT_NAME
#   2. PROJECT_NAME=<slug> in a committed .secretsrc at the repo root
#   3. the slugified repo directory name
# Pin it via .secretsrc so renaming the directory never changes your key paths.
#
# Subcommands:
#   init                        generate the dev+prod age keys and write .sops.yaml
#   rotate <dev|prod> [--rollback]  swap one environment's age key (verified, backed up)
#   import-key <file> <dev|prod> install a shared age private key for one environment
#   edit <dev|prod>             open the decrypted secrets in $EDITOR, re-encrypt on save
#   set <dev|prod> <NAME>       add/update one variable (value read from a hidden prompt)
#   import <file> <dev|prod>    encrypt an existing plaintext dotenv into secrets/<env>.enc.env
#   validate                    check both files declare the right variable NAMES (no key needed)
#   decrypt <dev|prod> [out]    write the decrypted plaintext to a gitignored file
#   encrypt <dev|prod> [in]     re-encrypt from a plaintext file, then delete the plaintext
#   clean                       remove any stray decrypted secrets/*.dec.env files
#   exec <dev|prod> -- <cmd>    run <cmd> with the decrypted secrets injected (no plaintext on disk)
#   push [dev|prod]             sync the decrypted secrets to your host (needs $SECRETS_DEPLOY_SYNC)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# How this script tells the user to re-invoke itself in hint messages. Works for
# every stack (npm projects usually alias these as `npm run secrets:*`, which
# call the same script).
SELF="bash scripts/secrets.sh"

# Resolve the project slug used as the age-key filename prefix (see header).
PROJECT_NAME="${SECRETS_PROJECT_NAME:-}"
if [[ -z "$PROJECT_NAME" && -f "$ROOT/.secretsrc" ]]; then
  PROJECT_NAME="$(grep -E '^PROJECT_NAME=' "$ROOT/.secretsrc" | head -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
fi
if [[ -z "$PROJECT_NAME" ]]; then
  PROJECT_NAME="$(basename "$ROOT" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"
fi
[[ -n "$PROJECT_NAME" ]] || PROJECT_NAME="app"

# PROJECT-SPECIFIC, PER-ENVIRONMENT key files, NOT the shared
# ~/.config/sops/age/keys.txt, so this project never reads, overwrites, or
# shares a key belonging to another project — and so the dev key can never
# decrypt the prod file (or vice versa). Override the directory with
# SOPS_AGE_KEY_DIR if you keep keys elsewhere.
AGE_KEY_DIR="${SOPS_AGE_KEY_DIR:-$HOME/.config/sops/age}"

die()  { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "'$1' not installed${2:+ ($2)}"; }

# --- environment-aware paths ------------------------------------------------

require_env() {
  case "${1:-}" in
    dev|prod) : ;;
    *) die "unknown env '${1:-}' — use: dev | prod" ;;
  esac
}

secrets_file() { require_env "${1:-}"; echo "secrets/$1.enc.env"; }
dec_file()     { require_env "${1:-}"; echo "secrets/$1.dec.env"; }
key_file_for() { require_env "${1:-}"; echo "$AGE_KEY_DIR/$PROJECT_NAME-$1.txt"; }

# Point every sops decrypt operation at THIS environment's private key only.
use_key() {
  local env="$1" kf; kf="$(key_file_for "$env")"
  export SOPS_AGE_KEY_FILE="$kf"
}

# The age public recipient for an environment, derived from its private key.
recipient_for() {
  local env="$1" kf; kf="$(key_file_for "$env")"
  [[ -f "$kf" ]] || die "no age key for $env at $kf — run: $SELF init"
  age-keygen -y "$kf"
}

# Encrypt a plaintext dotenv file to an environment's recipient. Pins the
# recipient explicitly with --age and bypasses .sops.yaml (--config /dev/null):
# creation-rule matching keys off the input path, which for a temp file would
# not match, so we skip it entirely. This also means it never writes plaintext
# to the committed path and works from any temp location.
encrypt_dotenv() {
  local plain="$1" env="$2" dest="$3" recipient
  recipient="$(recipient_for "$env")"
  sops --config /dev/null --encrypt --age "$recipient" \
    --input-type dotenv --output-type dotenv "$plain" > "$dest"
}

# Write .sops.yaml from the CURRENT dev+prod key files. Shared by `init` (first
# run) and `rotate` (after a key swap) so the config format has one definition.
# Only the PUBLIC recipients are emitted, so the result is safe to commit.
write_sops_yaml() {
  local dev_recipient prod_recipient
  dev_recipient="$(recipient_for dev)"
  prod_recipient="$(recipient_for prod)"

  {
    echo "# SOPS config: which age recipient may decrypt each secrets file."
    echo "# The keys below are PUBLIC and safe to commit. dev and prod use SEPARATE"
    echo "# recipients so the dev key cannot decrypt prod (or vice versa)."
    echo "# Regenerate with: $SELF init"
    echo "creation_rules:"
    echo "  - path_regex: secrets/prod\\.enc\\.env\$"
    echo "    age: \"$prod_recipient\""
    echo "  - path_regex: secrets/dev\\.enc\\.env\$"
    echo "    age: \"$dev_recipient\""
  } > .sops.yaml

  echo "▸ Wrote .sops.yaml (dev $dev_recipient / prod $prod_recipient)."
}

# Back up an environment's CURRENT key before it is overwritten: a timestamped
# .bak.<stamp> (keep the 3 newest) plus a stable .prev pointer for one-step
# rollback. The backups are what make a failed/undesired rotation recoverable.
backup_key() {
  local env="$1" kf; kf="$(key_file_for "$env")"
  [[ -f "$kf" ]] || die "no key to back up at $kf"
  local stamp bak n
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  bak="$kf.bak.$stamp"; n=1
  while [[ -e "$bak" ]]; do bak="$kf.bak.$stamp.$n"; n=$((n + 1)); done
  cp "$kf" "$bak";       chmod 600 "$bak"
  cp "$kf" "$kf.prev";   chmod 600 "$kf.prev"

  # Prune to the 3 newest backups. Names are ISO-timestamped, so a lexical sort
  # is chronological; delete everything but the last 3. (macOS head has no
  # negative -n, so compute the count to drop.)
  local list total drop
  list="$(ls -1 "$kf".bak.* 2>/dev/null | sort)"
  total="$(printf '%s\n' "$list" | grep -c .)"
  if [[ "$total" -gt 3 ]]; then
    drop=$((total - 3))
    printf '%s\n' "$list" | head -n "$drop" | while read -r old; do rm -f "$old"; done
  fi
}

# --- subcommands ------------------------------------------------------------

cmd_init() {
  need sops "brew install sops"
  need age  "brew install age"
  mkdir -p "$AGE_KEY_DIR"
  local env kf
  for env in dev prod; do
    kf="$(key_file_for "$env")"
    if [[ ! -f "$kf" ]]; then
      age-keygen -o "$kf" >/dev/null 2>&1 || die "age-keygen failed for $env"
      chmod 600 "$kf"
      echo "▸ Generated a new $env age key at $kf — keep it safe, never commit it."
    else
      echo "▸ Using existing $env age key at $kf."
    fi
  done

  write_sops_yaml
  cat <<EOF

Next steps:
  1. $SELF edit dev     # add local/sandbox values
  2. $SELF edit prod    # add production values
  3. Enable CI deploys by storing the PROD private key as a CI secret.
     For GitHub Actions:
       gh secret set SOPS_AGE_KEY_PROD < "$(key_file_for prod)"
     (plus whatever deploy credentials your host needs — see SECRETS-PIPELINE.md)
  4. Share the DEV key with teammates; keep the PROD key to yourself + CI.
EOF
}

# Install a shared age private key someone handed you (over a SECURE channel)
# for ONE environment. .sops.yaml is already committed, so once the key is in
# place you can decrypt that environment immediately.
cmd_import_key() {
  need age "brew install age"
  local src="${1:?usage: secrets.sh import-key <path-to-key.txt> <dev|prod>}"
  local env="${2:?usage: secrets.sh import-key <path-to-key.txt> <dev|prod>}"
  require_env "$env"
  local kf; kf="$(key_file_for "$env")"
  [[ -f "$src" ]] || die "no such file: $src"
  grep -q 'AGE-SECRET-KEY-1' "$src" || die "$src does not look like an age private key"
  if [[ -f "$kf" ]] && ! cmp -s "$src" "$kf"; then
    die "$kf already exists and differs. Move it aside first if you really mean to replace it:
       mv \"$kf\" \"$kf.bak\""
  fi
  mkdir -p "$AGE_KEY_DIR"
  cp "$src" "$kf"
  chmod 600 "$kf"
  local recipient; recipient="$(age-keygen -y "$kf")"
  echo "▸ Installed $env age key at $kf (recipient $recipient)."
  echo "  Verify you can decrypt:  $SELF edit $env"
}

# Seed a fresh encrypted file from .env.example (variable NAMES, dummy values).
seed_if_missing() {
  local env="$1" f; f="$(secrets_file "$env")"
  [[ -f "$f" ]] && return 0
  echo "▸ $f does not exist yet; seeding variable names from .env.example."
  local plain; plain="$(mktemp -t secrets-seed.XXXXXX)"
  if [[ -f .env.example ]]; then
    grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env.example > "$plain" || true
  fi
  [[ -s "$plain" ]] || printf '# add one NAME=value per line\n' > "$plain"
  encrypt_dotenv "$plain" "$env" "$f"
  rm -f "$plain"
}

cmd_edit() {
  need sops "brew install sops"
  local env="${1:?usage: secrets.sh edit <dev|prod>}"; require_env "$env"
  use_key "$env"
  [[ -f .sops.yaml ]] || die "no .sops.yaml — run: $SELF init"
  mkdir -p secrets
  seed_if_missing "$env"
  sops "$(secrets_file "$env")"   # decrypts to $EDITOR, re-encrypts on save
}

cmd_set() {
  need sops "brew install sops"
  local env="${1:?usage: secrets.sh set <dev|prod> <NAME>}"; require_env "$env"
  local name="${2:?usage: secrets.sh set <dev|prod> <NAME>}"
  [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "invalid variable name: $name"
  use_key "$env"
  local f; f="$(secrets_file "$env")"
  mkdir -p secrets
  seed_if_missing "$env"

  # Read the value from a hidden prompt so it never lands in argv or shell history.
  printf 'Value for %s in %s (input hidden): ' "$name" "$env" >&2
  local value; read -rs value; printf '\n' >&2
  [[ -n "$value" ]] || die "empty value — nothing set"

  local plain; plain="$(mktemp -t secrets-set.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -f '$plain' '$plain.body'" EXIT
  sops -d "$f" > "$plain"
  # Upsert: drop any existing line for this name, then append the new value.
  grep -vE "^${name}=" "$plain" > "$plain.body" || true
  mv "$plain.body" "$plain"
  printf '%s=%s\n' "$name" "$value" >> "$plain"
  encrypt_dotenv "$plain" "$env" "$f"
  rm -f "$plain"
  trap - EXIT
  echo "▸ Set $name in $f."
}

cmd_import() {
  need sops "brew install sops"
  local src="${1:?usage: secrets.sh import <file> <dev|prod>}"
  local env="${2:?usage: secrets.sh import <file> <dev|prod>}"
  require_env "$env"
  local f; f="$(secrets_file "$env")"
  [[ -f "$src" ]]      || die "no such file: $src"
  [[ -f .sops.yaml ]]  || die "no .sops.yaml — run: $SELF init"
  mkdir -p secrets
  encrypt_dotenv "$src" "$env" "$f"
  echo "▸ Encrypted $src -> $f. The plaintext $src is untouched; delete it when done."
}

# List the variable NAMES declared in an encrypted dotenv file WITHOUT
# decrypting: SOPS keeps dotenv keys in cleartext (only values are encrypted).
# Its own metadata keys are prefixed sops_ and are filtered out.
enc_names() {
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$1" | grep -vE '^sops_' | cut -d= -f1 | sort -u
}
example_names() {
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env.example | cut -d= -f1 | sort -u
}

cmd_validate() {
  [[ -f .env.example ]] || die "no .env.example to validate against"
  local status=0 env f
  for env in dev prod; do
    f="$(secrets_file "$env")"
    if [[ ! -f "$f" ]]; then
      echo "✗ $f is missing — create it with: $SELF edit $env"
      status=1; continue
    fi
    if ! grep -q '^sops_mac=' "$f" || ! grep -q 'ENC\[' "$f"; then
      echo "✗ $f is not a well-formed SOPS-encrypted dotenv file"
      status=1; continue
    fi
    local missing extra
    missing="$(comm -23 <(example_names) <(enc_names "$f"))"
    extra="$(comm -13 <(example_names) <(enc_names "$f"))"
    if [[ -n "$missing" || -n "$extra" ]]; then
      echo "✗ $f variable mismatch vs .env.example:"
      [[ -n "$missing" ]] && echo "    missing: $(echo "$missing" | tr '\n' ' ')"
      [[ -n "$extra"   ]] && echo "    extra:   $(echo "$extra" | tr '\n' ' ')"
      status=1
    else
      echo "✓ $f declares all expected variables."
    fi
  done
  return "$status"
}

cmd_decrypt() {
  need sops "brew install sops"
  local env="${1:?usage: secrets.sh decrypt <dev|prod> [outfile]}"; require_env "$env"
  use_key "$env"
  local f out; f="$(secrets_file "$env")"; out="${2:-$(dec_file "$env")}"
  [[ -f "$f" ]] || die "no $f to decrypt"
  sops -d "$f" > "$out"
  chmod 600 "$out"
  echo "⚠ Decrypted $f -> $out (PLAINTEXT on disk)."
  echo "  Re-encrypt and remove it with:  $SELF encrypt $env $out"
}

cmd_encrypt() {
  need sops "brew install sops"
  local env="${1:?usage: secrets.sh encrypt <dev|prod> [infile]}"; require_env "$env"
  local f in; f="$(secrets_file "$env")"; in="${2:-$(dec_file "$env")}"
  [[ -f "$in" ]] || die "no plaintext file $in to encrypt"
  mkdir -p secrets
  encrypt_dotenv "$in" "$env" "$f"
  rm -f "$in"
  echo "▸ Re-encrypted $in -> $f and removed the plaintext."
}

cmd_clean() {
  local removed=0 f
  for f in secrets/*.dec.env; do
    [[ -e "$f" ]] || continue
    rm -f "$f"; echo "▸ Removed $f."; removed=1
  done
  [[ "$removed" -eq 1 ]] || echo "▸ No decrypted secrets/*.dec.env files to clean."
}

# Refuse to start while decrypted secrets sit on disk: exec-env injects from the
# ENCRYPTED file, so any edits made in a stray plaintext copy would be silently
# ignored — and plaintext on disk is what this whole setup exists to avoid.
guard_no_plaintext() {
  local stray=() f
  for f in secrets/*.dec.env .dev.vars; do
    [[ -e "$f" ]] && stray+=("$f")
  done
  [[ ${#stray[@]} -eq 0 ]] && return 0
  {
    echo "error: decrypted secrets on disk: ${stray[*]}"
    echo "  Refusing to start — the running server reads only the ENCRYPTED files, so"
    echo "  plaintext edits would be ignored (and plaintext must not linger anyway)."
    echo "  Save + remove:   $SELF encrypt <env>    (for secrets/<env>.dec.env)"
    echo "  Discard instead: $SELF clean"
    [[ -e .dev.vars ]] && echo "  For .dev.vars:   $SELF import .dev.vars dev && rm .dev.vars"
    echo "  Then re-run this command."
  } >&2
  exit 1
}

# Run a command with the env-file's secrets injected. Degrades gracefully: if the
# file is missing or cannot be decrypted (fresh clone / CI without the age key),
# it warns and runs the command with no injected secrets rather than failing — the
# dev server still boots for tests that don't need real credentials.
cmd_exec() {
  local env="${1:?usage: secrets.sh exec <dev|prod> -- <cmd>}"; require_env "$env"; shift
  guard_no_plaintext
  [[ "${1:-}" == "--" ]] && shift
  [[ $# -gt 0 ]] || die "no command given after: exec $env --"
  use_key "$env"
  local f; f="$(secrets_file "$env")"
  if command -v sops >/dev/null && [[ -f "$f" ]] && sops -d "$f" >/dev/null 2>&1; then
    exec sops exec-env "$f" "$*"
  fi
  echo "⚠ secrets: running WITHOUT injected env ($f missing or undecryptable). Run: $SELF init" >&2
  exec "$@"
}

# Sync the decrypted secrets into your deploy host. Host-agnostic: the actual
# push command is whatever you set in $SECRETS_DEPLOY_SYNC. That command receives
# the secrets on stdin AND can reference the temp file path via $SECRETS_FILE
# (some CLIs take a filename argument instead of stdin). $SECRETS_DEPLOY_FORMAT
# picks the payload format:
#   json   (default) — e.g. Cloudflare:  SECRETS_DEPLOY_SYNC='wrangler secret bulk'
#   dotenv           — e.g. Fly.io:      SECRETS_DEPLOY_SYNC='fly secrets import'
# /jgl-setup-secrets writes these into .secretsrc for the host you pick.
cmd_push() {
  need sops "brew install sops"
  local env="${1:-prod}"; require_env "$env"; use_key "$env"
  local f; f="$(secrets_file "$env")"
  [[ -f "$f" ]] || die "no $f — create it with: $SELF edit $env"
  [[ -n "${SECRETS_DEPLOY_SYNC:-}" ]] || die "\$SECRETS_DEPLOY_SYNC is not set — that is the command that pushes secrets to your host.
  Set it (and optionally \$SECRETS_DEPLOY_FORMAT=json|dotenv) in .secretsrc, or run /jgl-setup-secrets. The command gets the payload on stdin, or as the file \$SECRETS_FILE. Examples:
    Cloudflare Workers:  SECRETS_DEPLOY_SYNC='wrangler secret bulk'   SECRETS_DEPLOY_FORMAT=json
    Fly.io:              SECRETS_DEPLOY_SYNC='fly secrets import'      SECRETS_DEPLOY_FORMAT=dotenv"
  local fmt="${SECRETS_DEPLOY_FORMAT:-json}"
  case "$fmt" in json|dotenv) : ;; *) die "SECRETS_DEPLOY_FORMAT must be json or dotenv, got '$fmt'" ;; esac
  local tmp; tmp="$(mktemp -t secrets-push.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -f '$tmp'" EXIT
  sops -d --output-type "$fmt" "$f" > "$tmp"
  # Run the host command through a shell so it may use pipes/redirection/args,
  # with the payload on both stdin and $SECRETS_FILE.
  SECRETS_FILE="$tmp" bash -c "$SECRETS_DEPLOY_SYNC" < "$tmp"
  rm -f "$tmp"; trap - EXIT
  echo "▸ Synced $f to your deploy host via: $SECRETS_DEPLOY_SYNC"
}

# Rotate ONE environment's age key in a single command, safely. The live key
# file and the committed ciphertext are the LAST things changed, and only after
# a full round-trip with the NEW key verifies — so any failure before that point
# leaves the old key and old ciphertext untouched (no lock-out possible). The
# old key is backed up first, so a fallback is always available (see --rollback).
cmd_rotate() {
  need sops "brew install sops"
  need age  "brew install age"
  local env="${1:?usage: secrets.sh rotate <dev|prod> [--rollback]}"; require_env "$env"
  local mode="${2:-}"
  if [[ "$mode" == "--rollback" ]]; then cmd_rotate_rollback "$env"; return; fi
  [[ -z "$mode" ]] || die "unknown option '$mode' — usage: rotate $env [--rollback]"

  local kf f; kf="$(key_file_for "$env")"; f="$(secrets_file "$env")"
  [[ -f "$kf" ]] || die "no age key for $env at $kf — nothing to rotate (run: $SELF init)"
  [[ -f "$f" ]]  || die "no $f to rotate — create it with: $SELF edit $env"

  # Precondition: the CURRENT key must decrypt the file. If it does not, rotating
  # would strand the ciphertext, so refuse before changing anything.
  use_key "$env"
  sops -d "$f" >/dev/null 2>&1 || die "$kf does not decrypt $f — refusing to rotate (you would lose access)."

  # Everything below stages into temp files (600, wiped on any exit). The
  # decrypted values never land in secrets/ and never depend on .gitignore.
  local plain newkey newenc
  plain="$(mktemp -t secrets-rotate-plain.XXXXXX)"
  newkey="$(mktemp -t secrets-rotate-key.XXXXXX)"
  newenc="$(mktemp -t secrets-rotate-enc.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -f '$plain' '$newkey' '$newenc'" EXIT
  chmod 600 "$plain" "$newkey"

  sops -d "$f" > "$plain"                          || die "decrypt failed — nothing changed."
  # age-keygen -o refuses to overwrite the mktemp'd file, so write via stdout.
  age-keygen > "$newkey" 2>/dev/null               || die "age-keygen failed — nothing changed."
  local new_recipient; new_recipient="$(age-keygen -y "$newkey")"
  sops --config /dev/null --encrypt --age "$new_recipient" \
    --input-type dotenv --output-type dotenv "$plain" > "$newenc" \
                                                   || die "re-encrypt failed — nothing changed."

  # Verify gate: the NEW key must decrypt the re-encrypted file AND the bytes
  # must match the original plaintext. Only past this do we touch live state.
  # The temp file has no .env extension, so tell sops it is dotenv explicitly.
  local check
  check="$(SOPS_AGE_KEY_FILE="$newkey" sops -d --input-type dotenv --output-type dotenv "$newenc" 2>/dev/null)" \
    || die "verification failed: new key cannot decrypt the re-encrypted file. Aborting; nothing changed."
  [[ "$check" == "$(cat "$plain")" ]] \
    || die "verification failed: round-trip mismatch. Aborting; nothing changed."

  # ---- commit point: from here on, live state changes ----
  backup_key "$env"                 # timestamped .bak + .prev, pruned to 3
  cp "$newenc" "$f"                 # new ciphertext
  cp "$newkey" "$kf"; chmod 600 "$kf"   # new live key
  write_sops_yaml                   # new recipient for this env; other env unchanged

  rm -f "$plain" "$newkey" "$newenc"; trap - EXIT

  echo "▸ Rotated $env age key. New recipient: $new_recipient"
  echo "  Old key backed up at $kf.prev (and a timestamped .bak.*; last 3 kept)."
  echo ""
  echo "Next steps:"
  echo "  1. Verify:  $SELF edit $env   (should open without error)"
  echo "  2. Commit:  git add .sops.yaml $f && git commit -m \"Rotate $env age key\""
  if [[ "$env" == "prod" ]]; then
    echo "  3. Update CI — run this yourself (the new PROD key must reach your CI):"
    echo "       gh secret set SOPS_AGE_KEY_PROD < $kf   # GitHub Actions"
  else
    echo "  3. Redistribute the new DEV key to teammates over a SECURE channel:"
    echo "       $kf"
    echo "     They install it with:  $SELF import-key <file> dev"
  fi
  echo "  Undo:  $SELF rotate $env --rollback"
}

# Restore the previous key for an environment from its .prev backup. The
# ciphertext + .sops.yaml are version-controlled, so the operator reverts those
# with git — this command only puts the old private key back in place.
cmd_rotate_rollback() {
  local env="$1"; require_env "$env"
  local kf f prev; kf="$(key_file_for "$env")"; f="$(secrets_file "$env")"; prev="$kf.prev"
  [[ -f "$prev" ]] || die "no backup at $prev to roll back to."
  cp "$prev" "$kf"; chmod 600 "$kf"
  echo "▸ Restored previous $env age key from $prev."
  echo "  Now revert the ciphertext + config to match the old key:"
  echo "     git checkout -- $f .sops.yaml"
  echo "  Verify:  $SELF edit $env"
}

case "${1:-}" in
  init)       shift; cmd_init "$@" ;;
  rotate)     shift; cmd_rotate "${1:-}" "${2:-}" ;;
  import-key) shift; cmd_import_key "${1:-}" "${2:-}" ;;
  edit)       shift; cmd_edit "${1:-}" ;;
  set)        shift; cmd_set "${1:-}" "${2:-}" ;;
  import)     shift; cmd_import "${1:-}" "${2:-}" ;;
  validate)   shift; cmd_validate ;;
  decrypt)    shift; cmd_decrypt "${1:-}" "${2:-}" ;;
  encrypt)    shift; cmd_encrypt "${1:-}" "${2:-}" ;;
  clean)      shift; cmd_clean ;;
  exec)       shift; cmd_exec "$@" ;;
  push)       shift; cmd_push "$@" ;;
  *) echo "usage: secrets.sh {init | rotate <env> [--rollback] | import-key <file> <env> | edit <env> | set <env> <NAME> | import <file> <env> | validate | decrypt <env> [out] | encrypt <env> [in] | clean | exec <env> -- <cmd> | push [env]}" >&2; exit 1 ;;
esac
