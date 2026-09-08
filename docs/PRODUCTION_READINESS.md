# Production-readiness audit — 2026-09-08

## Authentication

The Worker now uses Cloudflare's maintained OAuth provider with authorization codes, S256 PKCE, dynamic client registration, resource metadata, token expiry and single-owner consent. A raw owner bearer key cannot invoke MCP. The local Node target is a private development server; it is not the production OAuth endpoint.

Sources: [Cloudflare OAuth guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/securing-mcp-server/), [provider library](https://github.com/cloudflare/workers-oauth-provider), [OpenAI authentication requirements](https://developers.openai.com/plugins/build/auth).

## Instagram audit

The shared adapter uses the supported container lifecycle: create image children, poll status, create a CAROUSEL parent referencing child IDs, poll it, then call `media_publish` with `creation_id`. FINISHED permits publishing; ERROR/EXPIRED stop processing. HTTP calls time out; only safe reads retry transient errors. An ambiguous publish response requires manual reconciliation. D1 atomically claims each draft and preserves failed state, preventing concurrent duplicate requests and automatic reposts.

Meta's official collection confirms the Graph container/publish endpoints, professional-account requirement, Facebook Page linkage for Facebook Login, and permissions including `instagram_basic` and `instagram_content_publish`. The chosen app's actual permissions, account linkage, token expiry, review status and version access have **not** been verified with real Meta credentials. The default Graph version remains explicitly configurable; no claim is made that it is the latest version.

The Worker restricts carousel assets to its public JPEG objects, at most 8 MiB each and 2–10 items. The concrete generator requests square JPEGs. Upload checks validate MIME/signature and byte size; they do not decode JPEG dimensions or guarantee Meta acceptance. External image URLs are not fetched by the image adapter, preventing provider-returned URL SSRF. Owner-supplied uploads still require visual/format QA before approval.

Source: [Meta's official Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api). Rate/quota availability must be checked for the owner's app before enabling real publishing. No real content was published during this work.

## Image provider

The concrete adapter supports an OpenAI-compatible Images endpoint with inline base64 output, a configured model and `output_format: jpeg`. It writes image bytes to R2 and records the public asset in D1; core retains a vendor-neutral interface. Text generation serializes the generation brief into valid message content. Credentials, error bodies and tokens are not logged. Provider fetches reject redirects and use the Worker's public-network-only compatibility flag.

Source: [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation). Tests mock provider responses; no paid generation or live image-quality validation has been performed.

## Evidence boundaries and deployment

CI covers shared core/Instagram behaviors, authenticated Node MCP initialize/tools/list, Worker TypeScript, real local-runtime OAuth/MCP exchanges, R2 access controls, D1 concurrency, failure persistence, history repair and manual schedule approval, plus a Wrangler bundle dry run. Tests do not prove live Meta publishing, remote Cloudflare health, or successful ChatGPT UI connection.

At the account preflight, Wrangler authentication worked, but R2 returned Cloudflare error 10042 requiring account activation. Do not activate a billing-backed service without owner approval. The final verified Worker and MCP URLs must be reported only after remote health and authenticated MCP protocol checks pass. Keep `PUBLISHING_ENABLED=false` throughout deployment verification.

Remote provisioning completed: D1 `ghostwriter` (`a8f36e7e-ea90-4413-91da-9b3219551098`), both migrations applied; OAuth KV namespace `d8f21913223f4e7a8cd8a199a5a28b5e`. R2, Worker deployment and live protocol checks remain pending R2 activation approval. No AI or Meta credentials have been provisioned.
