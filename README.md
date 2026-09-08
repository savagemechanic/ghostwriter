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

## v0.1 — working core

Ghostwriter already has a runnable zero-dependency Node 22 core. It can:

- persist a creator/character identity and brand rules;
- weight content pillars from historical performance;
- generate structured carousel drafts through an OpenAI-compatible provider;
- validate 2–10 slide carousel specs;
- enforce per-brand hashtag limits;
- publish Instagram carousels through a Meta Graph API adapter;
- expose the workflow through a local HTTP API and dashboard;
- run entirely with Node built-ins in the first release.

```bash
cp .env.example .env
npm test
npm start
# open http://localhost:8787
```

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

See `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/SECURITY.md`, and `docs/ROADMAP.md`.

## License

AGPL-3.0. Self-host it, modify it, improve it. If you offer modified Ghostwriter as a network service, preserve the freedoms that made it possible.