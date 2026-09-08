# Ghostwriter

> **Your identity. Your strategy. Your infrastructure.**

Ghostwriter is a free, open-source, self-hosted AI social media operator for creators and engineers who want to own their content workflow instead of renting it from another SaaS.

**No per-seat tax. No artificial post limits. No locked workflows. Your stack, your data, your rules.**

> ⭐ If you believe your online identity should run on infrastructure you own, star the repo.

## Why Ghostwriter exists

Modern social media tools are useful, but the trade is familiar: subscriptions, feature tiers, usage limits, vendor lock-in, and more of your creative process living inside somebody else's product.

For engineers, the workflow is straightforward enough to own:

**identity → strategy → concept → carousel → QA → publish → analytics → learn → repeat**

Ghostwriter turns that workflow into software you can run yourself.

This project is not affiliated with Ocoya, Meta, Instagram, or any other commercial platform. Brand names are used only for descriptive comparison. Ghostwriter is an independent clean-room open-source project.

## Working core

Ghostwriter can:

- persist a creator/character identity and brand rules;
- weight content pillars from historical performance;
- generate structured carousel drafts through an OpenAI-compatible provider;
- validate 2–10 slide carousel specs;
- enforce per-brand hashtag limits;
- publish Instagram carousels through a Meta Graph API adapter;
- expose the workflow through a local HTTP API and dashboard;
- expose Ghostwriter directly inside ChatGPT through MCP;
- run as a normal Node service or as a Cloudflare Worker.

```bash
cp .env.example .env
npm test
npm start
# open http://localhost:8787
```

## $0 hosting path: Cloudflare

Ghostwriter now has a first-class deployment target in `apps/cloudflare`:

```text
ChatGPT
   │ MCP
   ▼
Cloudflare Worker
   ├── D1      identity / drafts / history / metrics
   ├── R2      carousel assets
   ├── AI API  generation
   └── Meta     Instagram publishing
```

The Worker exposes `/mcp` for ChatGPT and `/assets/*` for stable image URLs. Structured state lives in D1 instead of the local filesystem, and image assets live in R2. This keeps the Worker stateless and makes free-tier deployment practical.

See `apps/cloudflare/README.md` for the complete setup.

## First target: Instagram carousels

1. Load a creator identity and character rules.
2. Choose a content pillar and objective.
3. Generate a hook and 5–8 slide narrative.
4. Produce visual prompts and caption/prompt-pack copy.
5. Validate the carousel.
6. Supply publicly reachable generated image URLs.
7. Publish through Instagram's supported API surface.
8. Store performance data and bias future strategy toward stronger pillars.

## Core principles

- **Own the workflow.** Prompts, strategy, assets, and publishing logic stay portable.
- **Local-first where practical.** Cloud vendors are adapters, not architectural assumptions.
- **APIs over browser bots.** No Instagram password storage.
- **Provider independence.** AI vendors, models, and prices change.
- **Automation with observability.** Automated actions should be inspectable and retryable.
- **Useful before enormous.** One excellent Instagram pipeline before twenty shallow integrations.

## Architecture

```text
Identity → Strategy → Generation → Validation → Publish → Metrics
   ↑                                                        │
   └──────────────────── learning loop ─────────────────────┘
```

See `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/CHATGPT_APP.md`, `docs/SECURITY.md`, and `docs/ROADMAP.md`.

## ChatGPT app

Ghostwriter ships two MCP deployment paths:

- `apps/chatgpt` — conventional Node-hosted ChatGPT app server.
- `apps/cloudflare` — Cloudflare Workers + D1 + R2, intended as the simplest zero-server-cost path.

Both keep Ghostwriter core usable outside ChatGPT.

## License

AGPL-3.0. Self-host it, modify it, improve it. If you offer modified Ghostwriter as a network service, preserve the freedoms that made it possible.
