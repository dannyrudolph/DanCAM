# Deploy sync — Fly.io

`fly secrets import` reads **dotenv** (`NAME=value` lines) on stdin and sets them
on the app, triggering a release.

## Configure the sync command

Add to `.secretsrc`:

```sh
SECRETS_DEPLOY_SYNC='fly secrets import'
SECRETS_DEPLOY_FORMAT=dotenv
```

Then `bash scripts/secrets.sh push prod` decrypts `secrets/prod.enc.env` to
dotenv and pipes it to `fly secrets import`.

## CI credentials

Besides `SOPS_AGE_KEY_PROD`, the deploy workflow needs a `FLY_API_TOKEN`
(`fly tokens create deploy`), stored as a GitHub Actions secret. In the workflow
template: `DEPLOY_COMMAND` → `flyctl deploy --remote-only`;
`HOST_DEPLOY_CREDENTIAL` → `FLY_API_TOKEN`.

`fly secrets import` already restarts the app with the new values, so you can run
the "Sync runtime secrets" step instead of a separate deploy if you only changed
secrets.
