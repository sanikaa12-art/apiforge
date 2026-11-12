# APIForge — TODO (prioritized)

Ordered by value. All core features, tests and the production build, Docker and CI are done; see PROJECT_STATUS.md.

## P1 — AI differentiator
1. Set `ANTHROPIC_API_KEY` in `server/.env` → generate tests once against the live API (one call, low cost).

## P2 — Deployment (needs owner approval + account)
2. Deploy via `render.yaml` (or another host).

## P3 — Optional enhancements (only if budget allows)
- Seed demo data inside the Docker stack (compile seed.ts into dist).
- Multipart/form-data request bodies.
- External `$ref` resolution in OpenAPI import.
- Team workspaces / sharing.
