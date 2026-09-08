# Security model

Ghostwriter never asks for or stores an Instagram password. Publishing uses a user-supplied API access token in the process environment.

- Keep `.env` outside version control.
- Use appropriately rotated credentials where the platform permits.
- Put the dashboard behind authentication or reverse-proxy access control before exposing it to the public internet.
- Treat generated media URLs as potentially sensitive until published.
- Do not log access tokens or provider secrets.
- Prefer official platform APIs over browser automation.

The production Cloudflare MCP endpoint requires OAuth tokens from its single-owner consent flow. The owner key remains restricted to consent and JPEG upload operations. Public asset URLs are accessible before Instagram publication; use them only for intentionally public media. Publishing is disabled by default and failed/ambiguous posts require manual reconciliation. See [the Cloudflare runbook](../apps/cloudflare/README.md).
