# Ghostwriter on Cloudflare

Single-owner MCP server with OAuth 2.1 authorization-code + S256 PKCE, D1 state, OAuth KV, optional public JPEG assets in R2, and a 15-minute Cron. Publishing is disabled by default. Do not enable it or approve a scheduled post without the owner's explicit approval.

## Personal deployment without R2

The checked-in personal configuration uses Workers Free, D1 and KV only. R2 is not bound or activated. `/assets/*` returns 404 and `generate_images` is omitted from MCP discovery. No image-provider credentials are needed. Text generation requires an independently configured provider; without one it fails with a configuration error. Publishing stays disabled. The full R2 adapter remains available for deployments that opt in by adding an `ASSETS` R2 binding.

Free-plan quotas still apply. This configuration does not upgrade the Workers plan or automatically buy additional capacity. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/).

## Install and validate

Use Node 22 or newer. From this directory:

```sh
npm ci
npm run check
npm test
npx wrangler deploy --dry-run --outdir .wrangler/dry-run
```

`check` regenerates Worker environment/runtime types. Tests execute in Cloudflare's local runtime with D1, KV and R2 and run a real OAuth/MCP protocol exchange. They mock AI/Instagram requests and do not incur provider usage or publish anything. GitHub CI also runs core behavior and Node MCP protocol tests.

## Provision

Use an existing Cloudflare account and `npx wrangler whoami` to confirm it. Resource creation is separate from paid-plan activation. R2 may require billing enrollment even when usage fits its allowance; obtain owner approval before enabling that service. Do not upgrade a plan automatically.

```sh
npx wrangler d1 create ghostwriter
npx wrangler kv namespace create OAUTH_KV
```

Only for an optional image-enabled deployment, activate R2 with approval, create `ghostwriter-assets`, and add its `ASSETS` binding to `wrangler.jsonc`.

Record the D1 and KV IDs in `wrangler.jsonc`, then apply both migrations:

```sh
npm run db:migrate:remote
```

## Configuration and secrets

Use Wrangler's interactive secret input, never commit keys or paste them into a task transcript:

```sh
npx wrangler secret put GHOSTWRITER_ADMIN_TOKEN
npx wrangler secret put AI_API_KEY
npx wrangler secret put IMAGE_API_KEY
npx wrangler secret put INSTAGRAM_USER_ID
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN
```

The owner key must be a random secret of at least 24 characters. It is used only to approve OAuth consent and authenticate direct JPEG uploads; it is **not** an MCP access token. Store it in the owner's password manager. A missing/short key makes `/mcp` and OAuth fail closed with 503. `/health` and existing public JPEG GETs remain available.

Set these non-secret values in `wrangler.jsonc` for the chosen providers:

- `AI_API_URL` and `AI_MODEL`: OpenAI-compatible chat completions with JSON output.
- `IMAGE_API_URL` and `IMAGE_MODEL`: OpenAI-compatible image generations endpoint returning `data[0].b64_json`. The adapter requests one 1024×1024 JPEG, stores it in R2, and returns the Worker asset URL. URL-only image responses are rejected. This concrete adapter can be replaced without changing the generic core `generateImage(input)` interface.
- `META_GRAPH_BASE` and `META_GRAPH_VERSION`: must match the Meta login product and version selected in the owner's app. The default is Facebook Login at `graph.facebook.com`, version `v23.0`; do not substitute Instagram Login tokens.
- `PUBLIC_BASE_URL`: exact canonical HTTPS Worker origin, without a trailing slash. Set it once the Worker address is known; scheduled publishing requires it.
- `PUBLISHING_ENABLED`: leave `false` during setup and connection verification.

AI and Meta secrets can remain absent for protocol-only verification; their operations fail until configured. Image generation uses billable provider APIs when configured. This project does not create subscriptions or supply credentials.

## Deploy and connect

Deploy only when CI for the exact commit is green:

```sh
npm run deploy
```

Check the returned origin's `/health` and D1 response. Set `PUBLIC_BASE_URL` to that origin and deploy the configuration through the same green-CI gate. Connect ChatGPT to that origin plus `/mcp`, choosing OAuth. Discovery is served at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`. Dynamic client registration is `/oauth/register`; token exchange is `/oauth/token`.

The consent page displays the requesting client and callback origin. The owner enters the access key on that page and explicitly authorizes the client. Authorization uses a short-lived, single-use consent record, a secure HttpOnly cookie, origin checks and S256 PKCE. Access tokens expire after one hour and refresh grants after seven days. CIMD is disabled; dynamic registration is supported. This is an owner-only deployment, not a multi-tenant identity system.

Before calling a deployment verified, perform authenticated MCP `initialize`, then `tools/list`; `/health` alone is insufficient. Local tests establish protocol behavior, not successful linking in the actual ChatGPT UI. Test UI linking separately without publishing.

## Assets and scheduling

`PUT /assets/<new-key>.jpg` requires the owner bearer key. Only JPEG MIME/signature is accepted, with the actual stream limited to 8 MiB. Existing assets cannot be overwritten. GET/HEAD is public so Meta can retrieve images; don't upload private images. URLs used for Worker publishing must refer to existing JPEG objects on this Worker's origin.

All MCP schedules require manual approval. Approving a schedule is an external publishing authorization, and is blocked while publishing is disabled. Cron processes at most one due approved job per tick. D1 claims prevent simultaneous requests/runners from publishing a draft twice. Each Instagram operation is bounded to ten minutes; network requests have 30-second timeouts. Container states are polled before final publication. Failed or ambiguous writes are never automatically retried.

For a `publishing`, `running`, or `publish_failed` record after interruption, reconcile the account in Meta first. If the post exists, record its media ID and published timestamp in the draft; the next core publish request repairs missing history without posting again. Only reset a failed draft after independently establishing that no post was created. Do not reset state merely to clear an error.

## Local development

Put test secrets in ignored `.dev.vars`, run `npm run db:migrate:local`, then `npm run dev`. Tests use fake secrets and isolated local bindings. The `apps/chatgpt` Node target uses a private bearer gate for local development; use this Worker target for ChatGPT OAuth. The filesystem store supports one Node process per data directory; production concurrency uses D1.

See [the API/security audit](../../docs/PRODUCTION_READINESS.md) for documentation sources and remaining live verification requirements.

For remote protocol verification, from the repository root run:

```sh
node scripts/verify-deployment.mjs "$WORKER_ORIGIN" /path/to/private-owner-key-file
```

The script reads the key from the supplied private file, exercises OAuth, validates health and MCP discovery, and prints only successful verification results. It does not call publishing or generation tools. It creates a test OAuth client/grant; if revocation is advertised, it revokes the grant after testing.
