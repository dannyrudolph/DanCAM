#!/usr/bin/env bash
# UserPromptSubmit guard for Claude Code (optional/agent-guards). Stops a
# prompt that contains something shaped like a live credential before it is
# sent to the model (SEC-2/SEC-3). Exit 2 blocks the prompt and shows the
# message to the user; the prompt never reaches Claude.
#
# Patterns are deliberately specific — a provider prefix plus a long random
# body — so placeholders like sk_test_PLACEHOLDER or "your-key-here" pass.
set -u

input=$(cat)

PATTERNS=(
  'sk_(live|test)_[A-Za-z0-9]{20,}'          # Stripe secret keys
  'rk_(live|test)_[A-Za-z0-9]{20,}'          # Stripe restricted keys
  'sk-ant-[A-Za-z0-9_-]{20,}'                # Anthropic
  'sk-(proj-)?[A-Za-z0-9_-]{32,}'            # OpenAI
  'AKIA[0-9A-Z]{16}'                         # AWS access key id
  'gh[pousr]_[A-Za-z0-9]{36,}'               # GitHub tokens
  'github_pat_[A-Za-z0-9_]{50,}'             # GitHub fine-grained PAT
  'xox[abprs]-[A-Za-z0-9-]{20,}'             # Slack
  'AIza[0-9A-Za-z_-]{35}'                    # Google API key
  'AGE-SECRET-KEY-1[0-9A-Z]{40,}'            # age private key
  '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'    # PEM private keys
)

for p in "${PATTERNS[@]}"; do
  if printf '%s' "$input" | grep -Eq -- "$p"; then
    cat >&2 <<'MSG'
agent-guard: this prompt looks like it contains a live credential, so it was
not sent to the model.

If it's a real key, treat it as exposed and rotate it now — see
SECRETS-PIPELINE.md, "If a secret is exposed to the AI". Then put the new
value in your .env or secret store and refer to it by name
(process.env.STRIPE_API_KEY), never by value.

If it's a placeholder, use one that doesn't look like a real key
(sk_test_PLACEHOLDER) and send the prompt again.
MSG
    exit 2
  fi
done
exit 0
