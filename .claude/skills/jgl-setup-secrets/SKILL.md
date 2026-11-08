---
name: jgl-setup-secrets
description: Sets up encrypted-in-repo secrets with SOPS + age — separate dev and prod keys, verified rotation, a keyless manifest check, a pre-commit guard, and deploy sync. Use when the user says "set up secrets", "/jgl-setup-secrets", "encrypt my secrets", or asks how to handle API keys or .env safely.
disable-model-invocation: true
---

# Setup Secrets (SOPS + age)

Install the **optional secrets module** shipped under `optional/secrets/`. It
leaves the project with: real secret values encrypted in the repo (never
plaintext), **separate dev and prod age keys**, one-command verified key
rotation, a keyless manifest check, a pre-commit guard, and a host-specific
deploy sync.

This skill runs **only when invoked** — it is not part of automatic first-run
setup. But once invoked it makes real changes (generates keys, writes files), so
**confirm the plan with the user before generating anything**, and stop if they
decline. If the user would rather use a different tool (Doppler, 1Password,
git-crypt), don't force this — the "Secrets" rules in
`AGENTS.md` still apply, and they can `rm -rf optional/secrets/` to opt out.

Full reference: `SECRETS-PIPELINE.md` at the repo root.

## 1. Check requirements — `sops` and `age`

Run:

```bash
command -v sops && sops --version
command -v age  && age --version
```

If either is missing, print how to install and let the user do it before you
continue — **don't silently proceed** (a missing binary here means nothing gets
encrypted):

- **macOS:** `brew install sops age`
- **Debian/Ubuntu:** `sudo apt-get install -y age`, then install `sops` from
  its GitHub releases (`.deb` at https://github.com/getsops/sops/releases)
- **Other:** point them at the sops and age release pages.

If `brew` is present you may offer to run `brew install sops age` for them.
**Graceful degrade:** if the user wants to proceed without the tools installed,
you may still copy the files and wire scripts, but you **cannot** run `init`
(key generation) — say so clearly and leave a note that they must run
`bash scripts/secrets.sh init` once the tools are installed.

## 2. Confirm the project slug

The age keys are named `<slug>-dev.txt` / `<slug>-prod.txt` under
`~/.config/sops/age/`. The script derives `<slug>` from the repo directory name,
but a rename would then change the key paths — so **pin it**. Propose a slug
(the slugified directory name) and confirm, then write it to a committed
`.secretsrc` at the repo root:

```sh
PROJECT_NAME=my-app
```

## 3. Install the module files

Copy the module into the project (these paths are where the rest of the kit and
this skill expect them):

```bash
mkdir -p scripts
cp optional/secrets/scripts/secrets.sh      scripts/secrets.sh
cp optional/secrets/scripts/secrets.spec.ts scripts/secrets.spec.ts   # if the project uses Vitest; otherwise see step 7
chmod +x scripts/secrets.sh
```

Seed the variable-name catalogue (only if the project has no `.env.example`):

```bash
cp optional/secrets/templates/env.example.tmpl .env.example
```

Add the ignore rules **before** any secret exists (the encrypted `*.enc.env`
files ARE committed; everything else here is not):

```gitignore
# secrets: commit only the encrypted *.enc.env files
secrets/*.dec.env
*.dec.env
.dev.vars
.env
.env.*
!.env.example
```

Install the pre-commit guard (composes with any pre-push hook from
`/jgl-setup-testing` — different hook file, no conflict). If `.githooks/pre-commit`
already exists, **don't overwrite it** — show the user the change and let them
decide:

```bash
mkdir -p .githooks
cp optional/secrets/templates/pre-commit      .githooks/pre-commit
cp optional/secrets/templates/pre-commit.spec.ts .githooks/pre-commit.spec.ts   # if the project uses Vitest
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

If `core.hooksPath` is already set to something other than `.githooks`
(Husky's `.husky/`, lefthook, the pre-commit framework), don't repoint it —
that would switch off the hooks the repo already relies on. Show the user the
lines to add to their existing setup instead.

The hook refuses to commit a decrypted `*.dec.env`, a `.dev.vars`, a `.env`, or an
age private key (it flags the key *body*, so docs that merely mention the
`AGE-SECRET-KEY-1` marker are not false-positived). It also runs a keyless
manifest check. Separately, `secrets.sh exec` refuses to start the dev server
while any decrypted `secrets/*.dec.env` or `.dev.vars` sits on disk — the server
injects from the ENCRYPTED file, so a stray plaintext copy would be silently
ignored. Re-encrypt (`bash scripts/secrets.sh encrypt <env>`) or discard
(`bash scripts/secrets.sh clean`) to clear it.

Now generate the keys and `.sops.yaml`:

```bash
bash scripts/secrets.sh init
```

This creates both age keys under `~/.config/sops/age/` (never committed) and
writes `.sops.yaml` (public recipients only — safe to commit).

## 4. Add the real values

Have the user put their values in — **you never type or read the values**:

```bash
bash scripts/secrets.sh edit dev     # opens $EDITOR with the decrypted file
bash scripts/secrets.sh edit prod
# or one at a time, from a hidden prompt:
bash scripts/secrets.sh set dev SOME_API_KEY
```

Keep `.env.example` in sync with the names they add (`validate` enforces this).

## 5. Deploy sync — detect or ask the host

If the project deploys somewhere, wire the sync command. **Detect the host**
from the repo (don't guess silently), then confirm:

- `wrangler.toml` / `wrangler.jsonc` → **Cloudflare** →
  `optional/secrets/templates/deploy/cloudflare.md`
- `fly.toml` → **Fly.io** → `deploy/fly.md`
- `vercel.json` / Vercel project → **Vercel** → `deploy/vercel.md`
- otherwise **ask**, or skip if they deploy manually.

Append the chosen recipe's `SECRETS_DEPLOY_SYNC` / `SECRETS_DEPLOY_FORMAT` lines
to `.secretsrc`, and — if they deploy from CI — copy
`optional/secrets/templates/deploy/github-actions.yml.tmpl` to
`.github/workflows/deploy.yml` and fill in the `{{PLACEHOLDERS}}` from that host
doc. Tell the user to store the **prod** key in CI themselves (never do it for
them):

```bash
gh secret set SOPS_AGE_KEY_PROD < ~/.config/sops/age/<slug>-prod.txt
```

If there's no deploy target yet, skip this step — `push` stays unconfigured
until they set `SECRETS_DEPLOY_SYNC`.

## 6. Wire convenience scripts

For an **npm** project, add (don't replace existing scripts):

```json
{
  "scripts": {
    "secrets:init": "bash scripts/secrets.sh init",
    "secrets:rotate": "bash scripts/secrets.sh rotate",
    "secrets:import-key": "bash scripts/secrets.sh import-key",
    "secrets:edit": "bash scripts/secrets.sh edit",
    "secrets:set": "bash scripts/secrets.sh set",
    "secrets:import": "bash scripts/secrets.sh import",
    "secrets:validate": "bash scripts/secrets.sh validate",
    "secrets:decrypt": "bash scripts/secrets.sh decrypt",
    "secrets:encrypt": "bash scripts/secrets.sh encrypt",
    "secrets:clean": "bash scripts/secrets.sh clean",
    "secrets:push": "bash scripts/secrets.sh push prod"
  }
}
```

Wrap the dev command so local runs get secrets injected with no plaintext on
disk, e.g. `"dev": "bash scripts/secrets.sh exec dev -- <your dev command>"`.

For a **non-Node** project, skip the npm scripts — the `bash scripts/secrets.sh
<cmd>` form works everywhere. For the tests in step 7, use the project's test
runner or rely on `validate` + a manual round-trip.

## 7. Verify

Prove it works before finishing:

```bash
bash scripts/secrets.sh validate                 # keyless manifest check
bash scripts/secrets.sh edit dev                 # opens cleanly (Ctrl-C out)
# If Vitest is present, run the integration suites (isolation + rotation + push,
# plus the pre-commit hook guard):
npx vitest run scripts/secrets.spec.ts .githooks/pre-commit.spec.ts
```

Confirm the encrypted files decrypt with the right key and NOT the other one. If
anything fails, fix it in the same session — don't leave a half-configured
secrets setup.

## 8. Clean up and report

The module has been materialized into the project, so `optional/secrets/` can be
removed (or kept for reference):

```bash
rm -rf optional/secrets/
```

Then report honestly:

```
✓ sops 3.x + age present
✓ .secretsrc pinned slug: my-app
✓ scripts/secrets.sh + secrets.spec.ts installed
✓ two age keys generated (~/.config/sops/age/my-app-{dev,prod}.txt), .sops.yaml written
✓ .env.example seeded; .gitignore rules added
✓ .githooks/pre-commit installed; core.hooksPath = .githooks
✓ deploy sync: Cloudflare (wrangler secret bulk) wired in .secretsrc
✓ secrets:* npm scripts added
✓ secrets.spec.ts: 15 passed

Next:
  • Put real values in:  npm run secrets:edit -- dev   (and -- prod)
  • Store the PROD key in CI yourself:
        gh secret set SOPS_AGE_KEY_PROD < ~/.config/sops/age/my-app-prod.txt
  • Rotate a key anytime:  npm run secrets:rotate -- dev
  • Full runbook: SECRETS-PIPELINE.md
```
