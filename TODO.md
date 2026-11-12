# APIForge — TODO (prioritized)

Ordered by value. All core features, tests and the production build are done; see PROJECT_STATUS.md.

## P1 — CI (needs owner action)
1. `git init` + push to GitHub → confirm `.github/workflows/ci.yml` passes.

## P2 — AI differentiator
2. Set `ANTHROPIC_API_KEY` in `server/.env` → generate tests once against the live API (one call, low cost).

## P3 — Deployment (needs owner approval + account)
3. Deploy via `render.yaml` (or another host).

## P4 — Optional enhancements (only if budget allows)
- Seed demo data inside the Docker stack (compile seed.ts into dist).
- Multipart/form-data request bodies.
- External `$ref` resolution in OpenAPI import.
- Team workspaces / sharing.
