# HTTP API

Ghostwriter v0.1 ships a deliberately small local HTTP surface.

## `PUT /api/identity`
Stores the creator identity and brand rules.

## `GET /api/identity`
Returns the current identity.

## `POST /api/generate`
Body: `{ "objective": "engagement", "pillar": "optional" }`.
Generates and validates a carousel draft through the configured text provider.

## `POST /api/publish`
Body: `{ "draftId": "...", "imageUrls": ["https://...", "https://..."] }`.
Publishes a 2–10 image carousel using the Instagram publishing adapter.

## `GET /api/history`
Returns prior published posts and locally stored metrics used for strategy weighting.

## `GET /health`
Returns process health and version metadata.
