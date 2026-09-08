# Ghostwriter on Cloudflare

This deployment target runs Ghostwriter as a stateless MCP server on Cloudflare Workers, stores structured state in D1, and serves carousel assets from R2.

## Architecture

ChatGPT -> Worker `/mcp` -> Ghostwriter core -> D1 / R2 / AI provider / Instagram Graph API

## Setup

1. Install dependencies:

```bash
cd apps/cloudflare
npm install
```

2. Authenticate Wrangler:

```bash
npx wrangler login
```

3. Create the D1 database:

```bash
npx wrangler d1 create ghostwriter
```

Copy the returned `database_id` into `wrangler.jsonc`.

4. Create the R2 bucket:

```bash
npx wrangler r2 bucket create ghostwriter-assets
```

5. Apply the D1 migration:

```bash
npm run db:migrate:remote
```

6. Add secrets:

```bash
npx wrangler secret put AI_API_KEY
npx wrangler secret put AI_MODEL
npx wrangler secret put INSTAGRAM_USER_ID
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN
npx wrangler secret put GHOSTWRITER_ADMIN_TOKEN
```

`GHOSTWRITER_ADMIN_TOKEN` protects direct R2 uploads. The MCP endpoint is intentionally separate so it can later use OAuth for ChatGPT.

7. Deploy:

```bash
npm run deploy
```

Wrangler will return a `workers.dev` HTTPS URL. Your ChatGPT MCP endpoint is:

```text
https://<worker>.<subdomain>.workers.dev/mcp
```

## Asset uploads

Upload a generated image to R2 through the Worker:

```bash
curl -X PUT \
  -H "Authorization: Bearer $GHOSTWRITER_ADMIN_TOKEN" \
  -H "Content-Type: image/png" \
  --data-binary @slide-1.png \
  https://<worker>.<subdomain>.workers.dev/assets/carousels/example/slide-1.png
```

The response contains a stable public HTTPS URL suitable for Instagram's media publishing API.

## Local development

```bash
npm run db:migrate:local
npm run dev
```

Wrangler provides local D1/R2 simulations by default.

## Security note

Do not expose Instagram tokens or AI keys as ordinary Worker variables. Store them with `wrangler secret put`. Before publishing Ghostwriter as a multi-user ChatGPT app, add OAuth to `/mcp`; the current target is optimized for a single-owner deployment.
