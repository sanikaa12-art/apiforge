# APIForge — TODO (prioritized)

Ordered by value. All core features, tests and the production build, Docker and CI are done; see PROJECT_STATUS.md.

## P1 — Deployment (needs owner approval + free Render account)
1. Deploy via `render.yaml` (free plans), set ENCRYPTION_KEY + CORS_ORIGIN.

## P2 — Optional enhancements (only if budget allows)
- Optional: Claude generation (`AI_PROVIDER=claude`) once API credits are available.
- Seed demo data inside the Docker stack (compile seed.ts into dist).
- Multipart/form-data request bodies.
- External `$ref` resolution in OpenAPI import.
- Team workspaces / sharing.
