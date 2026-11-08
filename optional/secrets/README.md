# Secrets module (SOPS + age) — optional

A self-contained, **opt-in** module for encrypted-in-repo secrets management.
It is **not active until you install it** — the files here just sit under
`optional/secrets/` doing nothing. To turn it on, run `/jgl-setup-secrets` (or,
if slash commands don't work in your tool, read
`skills/jgl-setup-secrets/SKILL.md` and follow it). To opt out, delete this
folder.

## What it gives you

- **Secrets encrypted in the repo**, never plaintext. The committed
  `secrets/dev.enc.env` / `secrets/prod.enc.env` are ciphertext; the plaintext
  values never touch disk in the project and never enter an AI context.
- **Separate dev and prod keys.** A developer holds only the dev key; a leaked
  dev key exposes zero production secrets. CI holds only the prod key.
- **One-command, verified key rotation** with automatic backups and rollback.
- **A keyless manifest check** (`validate`) so CI/pre-commit can confirm the
  files declare the right variables without any key.
- **A pre-commit guard** that refuses to commit plaintext secrets or private keys.
- **A dev-server guard** — `exec` refuses to launch while a decrypted
  `*.dec.env` / `.dev.vars` lingers on disk (it injects from the encrypted file,
  so a stray plaintext copy would be silently ignored).
- **Host-agnostic deploy sync** (Cloudflare / Fly / Vercel / your own).

## Requirements

The [`sops`](https://github.com/getsops/sops) and
[`age`](https://github.com/FiloSottile/age) CLIs.

```sh
# macOS
brew install sops age
# Debian/Ubuntu: age via apt; sops from GitHub releases
sudo apt-get install -y age
# then grab the latest sops .deb from https://github.com/getsops/sops/releases
```

`/jgl-setup-secrets` checks for these first and prints install steps if missing.

## What's in this folder

```
optional/secrets/
  scripts/secrets.sh        the CLI (init/rotate/edit/set/import/validate/
                            decrypt/encrypt/clean/exec/push)
  scripts/secrets.spec.ts   Vitest integration tests (isolation + rotation + push)
  templates/
    pre-commit              guard: block plaintext secrets / age keys from commits
    pre-commit.spec.ts      Vitest tests for the pre-commit hook
    env.example.tmpl        the variable-NAME catalogue (dummy values)
    sops.yaml.tmpl          reference shape of the auto-generated .sops.yaml
    deploy/                 host-specific decrypt→inject recipes + CI workflow
```

## How the skill installs it

`/jgl-setup-secrets` copies `scripts/secrets.sh` into your project, generates the
two age keys and `.sops.yaml`, seeds `.env.example`, wires convenience scripts
(e.g. npm `secrets:*`), installs the pre-commit guard, picks a deploy-sync recipe
for your host, and writes the `SECRETS.md` runbook — then verifies with a real
round-trip. See `SECRETS-PIPELINE.md` at the repo root for the full reference.

## The commands (once installed)

```sh
bash scripts/secrets.sh init            # generate dev+prod keys and .sops.yaml
bash scripts/secrets.sh edit dev        # edit decrypted values in $EDITOR
bash scripts/secrets.sh set dev NAME    # set one variable (hidden prompt)
bash scripts/secrets.sh validate        # keyless: names match .env.example
bash scripts/secrets.sh rotate dev      # swap a key (verified, backed up)
bash scripts/secrets.sh exec dev -- npm run dev   # run a cmd with secrets injected
bash scripts/secrets.sh push prod       # sync secrets to your deploy host
```

Node projects usually alias these as `npm run secrets:init`, `secrets:edit`, etc.
