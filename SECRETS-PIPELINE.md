# Secrets Pipeline (SOPS + age)

The full reference for the **optional secrets module** (`optional/secrets/`).
This is to secrets what `TESTING-PIPELINE.md` is to testing: the deep-dive you
read once you've decided to use it. To turn it on, run `/jgl-setup-secrets`
(or read `skills/jgl-setup-secrets/SKILL.md` and follow it). It is **opt-in** —
nothing here runs until you install it.

The model is stack-agnostic. Where a concrete tool is named (npm, Cloudflare,
GitHub Actions), it's an example — swap in your project's actual commands.

## The idea

Every secret — local **and** production — lives in **one encrypted file
committed to the repo**:

- `secrets/dev.enc.env` — local / sandbox values
- `secrets/prod.enc.env` — production values

Both are committed, but **encrypted** with [SOPS](https://github.com/getsops/sops)
+ [age](https://github.com/FiloSottile/age); the ciphertext is useless without
the age private key. This replaces hand-entering secrets in a hosting dashboard:
the encrypted file is the one source of truth, and everything else (local dev, CI
deploy) reads from it. The variable **names** are catalogued in `.env.example`
(dummy values); the **values** live only inside the encrypted files.

**Why this and not a plaintext `.env`:** a plaintext `.env` can't be committed
(so it drifts per-machine and is easy to leak), and it's exactly the file an AI
assistant must never read. An encrypted file is safe to commit, safe to diff,
and safe to have in an AI's working tree — the AI works with variable *names*
only, never values.

## Requirements

The `sops` and `age` CLIs:

```sh
# macOS
brew install sops age
# Debian/Ubuntu — age from apt, sops from GitHub releases
sudo apt-get install -y age
# then install the latest sops .deb from https://github.com/getsops/sops/releases
```

`/jgl-setup-secrets` checks for both before doing anything.

## Two keys: dev and prod are encrypted separately

**dev and prod use different age keys.** `secrets/dev.enc.env` is encrypted to
the dev recipient; `secrets/prod.enc.env` to the prod recipient. The two files
therefore require **different private keys** to decrypt:

| Key file | Decrypts | Held by |
| :-- | :-- | :-- |
| `~/.config/sops/age/<slug>-dev.txt` | `secrets/dev.enc.env` only | every developer |
| `~/.config/sops/age/<slug>-prod.txt` | `secrets/prod.enc.env` only | the owner + CI |

`<slug>` is your project name, pinned in `.secretsrc` (`PROJECT_NAME=...`) so a
directory rename never moves your keys.

Why bother: a developer only ever needs the **dev** key, and a dev key on a
laptop (or leaked) exposes **zero production credentials**. CI holds only the
**prod** key and cannot decrypt dev even in principle. The public recipients for
both live in `.sops.yaml` (safe to commit); the private keys never enter the repo
(`.gitignore` blocks `*.dec.env`, `.env`, and the age keys live outside the repo
entirely).

## One-time setup

```bash
# 1. Generate BOTH age keys (dev + prod) and write .sops.yaml (public recipients)
bash scripts/secrets.sh init

# 2. Fill in values (opens $EDITOR with the decrypted file; re-encrypts on save)
bash scripts/secrets.sh edit dev
bash scripts/secrets.sh edit prod

# 3. Commit the encrypted files and .sops.yaml
git add .sops.yaml secrets/dev.enc.env secrets/prod.enc.env .env.example .secretsrc
git commit -m "Add encrypted secrets"
```

- The age **private** keys are written under `~/.config/sops/age/` and are
  **never** committed. Back them up somewhere safe (a password manager) — losing
  a key means you can't decrypt that environment.
- `.sops.yaml` holds only the **public** recipients and is safe to commit.

Node projects usually alias the commands as `npm run secrets:init`,
`secrets:edit`, etc. — same script.

## Daily use

```bash
bash scripts/secrets.sh edit dev            # open the whole file in $EDITOR (or: prod)
bash scripts/secrets.sh set dev SOME_KEY    # add/update ONE var (value from a hidden prompt)
bash scripts/secrets.sh validate            # check both files declare the right var NAMES (no key)
bash scripts/secrets.sh rotate dev          # swap this env's age key (see "Rotating a key")
```

`set` reads the value from a hidden prompt, so it never lands in your shell
history or in `argv`.

### Running your app with secrets injected

`exec` runs any command with the decrypted secrets in its environment and **no
plaintext file on disk**:

```bash
bash scripts/secrets.sh exec dev -- npm run dev
```

`exec` **refuses to start** if a decrypted `secrets/*.dec.env` or a `.dev.vars`
is sitting on disk: it injects from the ENCRYPTED file, so edits made in a stray
plaintext copy would be silently ignored — and plaintext must not linger anyway.
Re-encrypt it (`bash scripts/secrets.sh encrypt <env>`) or discard it
(`bash scripts/secrets.sh clean`) and re-run.

Otherwise it degrades gracefully: on a fresh clone or in CI without the key, it
warns and runs the command with no injected secrets rather than failing — fine
for tests that only exercise input validation.

### Editing in a GUI editor

`edit` opens the decrypted file in `$EDITOR` in a temp file **outside the repo**,
then re-encrypts on close — no plaintext lands in the project folder. Point
`$EDITOR` at your editor's wait mode:

```bash
EDITOR="code --wait" bash scripts/secrets.sh edit dev    # VS Code
```

Or decrypt → edit a real file → re-encrypt:

```bash
bash scripts/secrets.sh decrypt dev     # writes secrets/dev.dec.env (PLAINTEXT, gitignored)
$EDITOR secrets/dev.dec.env
bash scripts/secrets.sh encrypt dev     # re-encrypts and DELETES the plaintext
bash scripts/secrets.sh clean           # safety net: remove any stray *.dec.env
```

## Onboarding another developer

A developer needs **only the dev key** — never hand out the prod key.

1. Share `~/.config/sops/age/<slug>-dev.txt` over a **secure channel** (a
   password manager or an age/PGP-encrypted message). **Never** plain email,
   Slack, chat, or an AI assistant — a key that touches any of those is
   compromised and must be [rotated](#rotating-a-key).
2. They install it: `bash scripts/secrets.sh import-key <file> dev`. Now they can
   `edit dev` and run the app immediately. They **cannot** decrypt prod — the point.

If a developer leaves, rotate only the **dev** key; production is untouched.

## Validating the manifest (no key required)

SOPS keeps dotenv **variable names in cleartext** (only values are encrypted), so
`validate` confirms both files declare exactly the variables in `.env.example`
**without any age key**. Run it in CI and the pre-commit hook as a keyless guard
so a broken manifest can't ship.

## Git hooks

Install the pre-commit guard and point git at the version-controlled hooks path
(once per clone):

```bash
git config core.hooksPath .githooks
```

`.githooks/pre-commit` refuses to commit a decrypted `*.dec.env`, a `.dev.vars`,
a `.env`, or an age private key (by filename **or** by scanning staged content
for an `AGE-SECRET-KEY-1` **key body** — a bare mention of the marker in docs or
code is not flagged), and runs the keyless `validate` when the encrypted files
exist. It composes with the pre-push hook from `/jgl-setup-testing` (a different
file). Bypass only in emergencies: `git commit --no-verify`.

## Production / CI deploy

The Worker/host must have the secret values at request time and can't run SOPS at
the edge, so the deploy step **decrypts the prod file and pushes the values into
the host** — synced from the encrypted source, never typed into a dashboard.

Configure the host sync in `.secretsrc`:

```sh
SECRETS_DEPLOY_SYNC='wrangler secret bulk'   # the command that receives the payload
SECRETS_DEPLOY_FORMAT=json                    # json (default) or dotenv
```

Then `bash scripts/secrets.sh push prod` decrypts `secrets/prod.enc.env` in the
chosen format and pipes it to that command (the payload is also available as the
file `$SECRETS_FILE`). Host-specific recipes:

- Cloudflare → `optional/secrets/templates/deploy/cloudflare.md`
- Fly.io → `deploy/fly.md`
- Vercel → `deploy/vercel.md`
- CI workflow → `deploy/github-actions.yml.tmpl`

CI needs the **prod** age private key as a secret (the only app-decryption key it
holds — it can't decrypt dev). For GitHub Actions:

```bash
gh secret set SOPS_AGE_KEY_PROD < ~/.config/sops/age/<slug>-prod.txt
```

plus whatever deploy credential your host needs (e.g. `CLOUDFLARE_API_TOKEN`).

## Least-privilege production keys

Where a provider offers scoped/restricted API keys (Stripe restricted keys, cloud
IAM roles, scoped tokens), production should carry the **narrowest scope the app
actually uses**, so a leaked key can't do more than the app can. Survey the real
API surface before each deploy and mint a key to match — don't grant scopes "just
in case." The dev/sandbox key can stay broader for convenience; only prod is held
to least privilege.

## Rotating a key

### If a secret is exposed to the AI

This subsection applies whether or not you use this module — it is the
procedure `AGENTS.md` rule **SEC-3** points at.

A secret reaches the AI when the user pastes a key into chat, asks the agent
to read a file that turns out to contain one, shares a screenshot with one
visible, or the agent finds one already committed. In every one of those
cases the value is **burned**: it may be retained by the model provider,
captured in a transcript, or resurface in a later session. Deleting the
message, the file, or the commit does not un-expose it.

1. **Stop the task.** Don't finish what you were asked to do first — rotation
   comes before everything else.
2. **Say plainly that the key is compromised and must be rotated now.**
3. **Give the concrete path for that provider** when you can name it:
   - Stripe → Dashboard → Developers → API keys → **Roll key**
   - GitHub → Settings → Developer settings → Personal access tokens →
     **Revoke**, then generate a replacement
   - AWS → IAM → Users → Security credentials → **Deactivate**, then **Delete**
     the access key, and create a new one
   - Google Cloud → APIs & Services → Credentials → **Regenerate key**
   - OpenAI / Anthropic → Dashboard → API keys → **Revoke**, create new
   - Database / Redis / SMTP → rotate the password at the server, then update
     every consumer

   If you can't name the provider's exact path, say to find the credential in
   its dashboard and revoke or rotate it there.
4. **If the value is in git history, warn that `git rm` plus a new commit is
   not enough.** The old value is still recoverable from prior commits and
   from every clone and fork. Rotation is mandatory; history rewriting
   (`git filter-repo`, BFG) is optional cleanup that never substitutes for it.
5. **Only after the user confirms rotation**, set up the safe pattern for the
   replacement (`AGENTS.md` SEC-4, or this module below) and resume the
   original task.

### Rotating a leaked *provider* secret

If a real credential (a Stripe/DB/API key) leaked, it must be **rotated at the
provider** — re-encrypting is not enough once the value is exposed. Then:

```bash
bash scripts/secrets.sh edit prod    # paste the new value, save
git commit -am "Rotate <provider> key"
git push                             # CI re-syncs it to the host
```

### Rotating an *age* key itself

One command, one environment at a time:

```bash
bash scripts/secrets.sh rotate dev     # or: prod
```

`rotate` decrypts the file with the current key, mints a new key, re-encrypts to
it, and **verifies the new key round-trips before touching anything live** — if
that check fails it aborts with the old key and old ciphertext untouched, so a
rotation can never lock you out. Only after the check passes does it back up the
old key, swap in the new one, and rewrite `.sops.yaml` for that environment.

The old key is preserved as a fallback: `<key>.prev` plus timestamped
`<key>.bak.<stamp>` backups (3 newest kept). To undo:

```bash
bash scripts/secrets.sh rotate dev --rollback     # restores <key>.prev
git checkout -- secrets/dev.enc.env .sops.yaml     # revert ciphertext + config
```

After a successful rotate, do the two steps it prints: **commit** the
re-encrypted file + config, and **redistribute the new key** — dev to teammates
(`import-key`), prod to CI (`gh secret set SOPS_AGE_KEY_PROD`, run it yourself).
Because the environments use separate keys, rotating **dev** never touches
production and vice versa.

> Don't hand-run `sops updatekeys` with this layout: keys are pinned one-file-per
> environment, so `updatekeys` can't see the old key once you've swapped it.
> `rotate` is the supported path.

## Command reference

| Command | What it does |
| :-- | :-- |
| `init` | generate the dev+prod age keys and write `.sops.yaml` |
| `rotate <env> [--rollback]` | swap one environment's age key (verified, backed up) |
| `import-key <file> <env>` | install a shared age private key for one environment |
| `edit <env>` | open the decrypted secrets in `$EDITOR`, re-encrypt on save |
| `set <env> <NAME>` | add/update one variable (value from a hidden prompt) |
| `import <file> <env>` | encrypt an existing plaintext dotenv into `secrets/<env>.enc.env` |
| `validate` | check both files declare the right variable NAMES (no key needed) |
| `decrypt <env> [out]` | write the decrypted plaintext to a gitignored file |
| `encrypt <env> [in]` | re-encrypt from a plaintext file, then delete the plaintext |
| `clean` | remove any stray decrypted `secrets/*.dec.env` files |
| `exec <env> -- <cmd>` | run `<cmd>` with the decrypted secrets injected |
| `push [env]` | sync the decrypted secrets to your host (needs `SECRETS_DEPLOY_SYNC`) |

## Testing

`scripts/secrets.spec.ts` is a Vitest integration suite that runs the real
script against real `sops`/`age` in a throwaway repo (skipped if the binaries are
absent). It covers the load-bearing properties: the dev↔prod key **isolation
boundary**, set/edit/decrypt/encrypt round-trips, keyless `validate`, `push`
piping to a stand-in host command, and the full **rotation** story (values
survive, old key locked out, other env untouched, `.prev` fallback works, backups
pruned to 3, rollback, and refusal when the current key can't decrypt). On a
non-Vitest project, rely on `validate` plus a manual round-trip.
