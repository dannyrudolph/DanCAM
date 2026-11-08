# Deploy sync — Vercel

Vercel has no bulk-stdin import, so the sync command loops over the decrypted
dotenv and calls `vercel env add` per variable. Point `SECRETS_DEPLOY_SYNC` at a
small helper that reads the dotenv payload from `$SECRETS_FILE`.

## Configure the sync command

Add to `.secretsrc`:

```sh
SECRETS_DEPLOY_FORMAT=dotenv
SECRETS_DEPLOY_SYNC='while IFS="=" read -r k v; do [ -z "$k" ] && continue; case "$k" in \#*) continue;; esac; printf "%s" "$v" | vercel env add "$k" production --force; done < "$SECRETS_FILE"'
```

Then `bash scripts/secrets.sh push prod` decrypts to dotenv and runs the loop,
adding each variable to the Production environment.

## CI credentials

Besides `SOPS_AGE_KEY_PROD`, store a `VERCEL_TOKEN` (Account Settings → Tokens)
as a GitHub Actions secret and pass `--token "$VERCEL_TOKEN"` to the `vercel`
commands. In the workflow template: `DEPLOY_COMMAND` → `vercel deploy --prod --token "$VERCEL_TOKEN"`;
`HOST_DEPLOY_CREDENTIAL` → `VERCEL_TOKEN`.

## Simpler alternative

If you prefer, skip runtime sync entirely and let Vercel read secrets at build
time via `sops exec-env secrets/prod.enc.env '<build command>'` in CI, so the
values are injected into the build without being stored in Vercel's dashboard.
