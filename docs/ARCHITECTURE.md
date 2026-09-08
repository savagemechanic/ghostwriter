# Architecture

Ghostwriter is a self-hosted social media operator built around replaceable adapters and a small orchestration core.

```text
Identity -> Strategy -> Generation -> Validation -> Publish -> Metrics
   ^                                                        |
   +---------------------- learning loop --------------------+
```

## Core

- `identity.js`: validation and normalization of persistent creator identity.
- `strategy.js`: post scoring, content-pillar weighting, and weighted selection.
- `carousel.js`: generation briefs, carousel validation, and caption rules.
- `service.js`: end-to-end orchestration.
- `store.js`: durable JSON persistence for the zero-dependency MVP.

## Adapters

- `ai.js`: OpenAI-compatible structured text generation interface.
- `instagram.js`: carousel creation/publishing through Meta's Graph API.

The first release intentionally uses Node built-ins only. This makes the MVP inspectable and immediately runnable while leaving clear seams for Postgres, queues, object storage, alternate LLMs, image providers, and additional social platforms.
