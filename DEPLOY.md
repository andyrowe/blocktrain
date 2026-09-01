# Deploying blocktrain.org (static PoC)

The site is `site/` — three static files, no build step:
`index.html`, `verify.mjs`, `blocktrain-poc.json`.

Free static hosting on Cloudflare Pages (bsv.cx already uses Cloudflare, so DNS is one click).
Requires an Andy action — I hold no Cloudflare or registrar credentials.

## Option A — Wrangler direct upload (fastest)

```
cd ~/projects/blocktrain
npx wrangler pages project create blocktrain --production-branch main   # first time
npx wrangler pages deploy site --project-name blocktrain
```
`wrangler` will open a browser to log into your Cloudflare account.

## Option B — Git-connected (auto-deploy on push)

When there's a GitHub remote (see below), in the Cloudflare dashboard:
Pages → Create → Connect to Git → pick the repo →
**Build command:** *(none)* · **Build output directory:** `site`.

## Point the domain

After the Pages project exists: Pages → your project → **Custom domains** → add
`blocktrain.org` (and `www` if wanted). Since blocktrain.org's DNS is on Cloudflare,
this auto-creates the record (CNAME flattening at the apex). TLS is automatic.

## Verify it's live

```
curl -sO https://blocktrain.org/verify.mjs
curl -sO https://blocktrain.org/blocktrain-poc.json
node verify.mjs blocktrain-poc.json      # expect: ✅ VERIFIED
```

## Refreshing the PoC bundle

If you seal new public entries and want them on the page:
```
node scripts/publish.ts <sealIndex> > site/blocktrain-poc.json
```
Only publish batches whose entries are safe to disclose.
