# Deploy sync — Cloudflare (Workers / Pages)

Cloudflare's `wrangler secret bulk` reads a **JSON** object of `{ "NAME": "value" }`
on stdin (or as a file argument) and uploads each as a Worker secret.

## 1. Configure the sync command

Add to `.secretsrc` (committed, no secrets in it):

```sh
SECRETS_DEPLOY_SYNC='wrangler secret bulk'
SECRETS_DEPLOY_FORMAT=json
```

Then `bash scripts/secrets.sh push prod` decrypts `secrets/prod.enc.env` to JSON
and pipes it to `wrangler secret bulk`.

## 2. CI credentials

In addition to `SOPS_AGE_KEY_PROD`, the deploy workflow needs:

| GitHub secret | What it is |
| :-- | :-- |
| `CLOUDFLARE_API_TOKEN` | a Workers-deploy API token (My Profile → API Tokens) |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account ID |

## 3. Workers runtime note

The Workers runtime has no Node `http`. If your code uses an SDK that defaults to
Node transports (e.g. Stripe), construct it with the fetch HTTP client and use
the async crypto APIs. Read secrets from the Worker `env`, never from a static
asset — anything `PUBLIC_`-prefixed ships to the browser.

Build/deploy commands for the workflow template:
`BUILD_COMMAND` → your build (e.g. `npm run build`);
`DEPLOY_COMMAND` → `npx wrangler deploy`;
`HOST_DEPLOY_CREDENTIAL` → `CLOUDFLARE_API_TOKEN`.
