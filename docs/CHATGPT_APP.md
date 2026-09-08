# Ghostwriter in ChatGPT

Ghostwriter includes a ChatGPT-facing MCP App in `apps/chatgpt`. The app is intentionally thin: ChatGPT is the conversational interface, while Ghostwriter's existing core remains the source of truth for identity, strategy, drafts, publishing, and analytics.

## Tool surface

| Tool | Effect |
| --- | --- |
| `get_identity` | Read the current creator/brand identity. |
| `save_identity` | Create or replace identity and brand rules. |
| `generate_carousel` | Generate and persist a carousel draft. |
| `get_draft` | Retrieve a draft by ID. |
| `get_history` | Read published-post history and stored metrics. |
| `record_metrics` | Add performance metrics to a published post. |
| `publish_carousel` | Publish a real carousel through Meta's Graph API. |

`generate_carousel` and `get_draft` are connected to a compact Apps SDK preview resource. The publishing action is deliberately separate from generation so a user can review a draft before any external side effect.

## Run the app

From the ChatGPT app package:

```bash
cd apps/chatgpt
npm install
npm start
```

By default the MCP endpoint is:

```text
http://localhost:8788/mcp
```

ChatGPT connects to a **remote** MCP server, not directly to localhost. During development, expose the local server over HTTPS using a trusted tunnel, or deploy it to your own HTTPS host. Then add:

```text
https://YOUR-HOST/mcp
```

as the custom app/MCP URL in ChatGPT Developer Mode.

## Environment

The ChatGPT app reuses the root Ghostwriter environment variables:

```bash
AI_API_URL=...
AI_API_KEY=...
AI_MODEL=...
META_GRAPH_BASE=https://graph.facebook.com
META_GRAPH_VERSION=v23.0
INSTAGRAM_USER_ID=...
INSTAGRAM_ACCESS_TOKEN=...
GHOSTWRITER_DATA_DIR=./data
CHATGPT_APP_PORT=8788
```

Never commit real access tokens. For a public multi-user deployment, replace single-process environment credentials with per-user OAuth and encrypted credential storage before accepting third-party users.

## Connect in ChatGPT

1. Deploy or tunnel the server over HTTPS.
2. Enable Developer Mode in ChatGPT.
3. Create a custom app and point it to `https://YOUR-HOST/mcp`.
4. Refresh the custom app whenever tools or metadata change.
5. In a conversation, select or mention Ghostwriter and ask for an action, for example:

```text
Ghostwriter, show me my current identity.
Ghostwriter, create an educational carousel optimized for saves.
Ghostwriter, load draft <id>.
Ghostwriter, publish draft <id> with these image URLs.
```

## Plan limitations

The Ghostwriter server exposes both read and write tools. ChatGPT plan/workspace policy determines which of those tools can actually be enabled. As of September 2026, OpenAI documents full MCP modify/write actions for Business and Enterprise/Edu, while Pro custom MCP use remains limited to read/fetch permissions in Developer Mode.

## Production hardening before public distribution

The current app is appropriate for private/self-hosted use. Before public Plugin Directory submission, add:

- OAuth-based Ghostwriter accounts and per-user Meta authorization;
- encrypted token storage and token rotation;
- rate limiting and abuse controls;
- explicit privacy policy and support/contact pages;
- audit logs for publishing actions;
- durable database/object storage rather than JSON files;
- deployment health checks and retry queues;
- submission-ready widget domain/CSP metadata.
