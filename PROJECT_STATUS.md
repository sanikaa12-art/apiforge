# APIForge — Project Status

_Last updated: 2026-11-12_

## Summary

All core features are built and verified end to end in a real browser, with a
real database. Every automated test suite passes, the typecheck and production
build succeed, and the full Docker stack (Postgres, Redis, API, BullMQ worker,
web) was built and smoke-tested on 2026-11-12. CI passes on GitHub Actions. No paid service
is required; Claude is an optional, off-by-default add-on.

## Definition of done

| Criterion | Status | Evidence |
|---|---|---|
| Core workflows function end to end | ✅ Done | Manual browser walkthrough + 7 Playwright e2e tests |
| Database migrations work | ✅ Done | `20261110161127_init` applied to a fresh DB by every test run and by `db:migrate` |
| Automated tests executed | ✅ Done | 89 backend (Vitest + Supertest), 9 web unit (Vitest + Testing Library), 7 e2e (Playwright). All pass. |
| Production build succeeds | ✅ Done | `npm run typecheck && npm run build` exit 0 (re-checked 2026-11-12) |
| Docker configuration works | ✅ Done | `docker compose up --build`: all 5 services up; smoke test passed (see below) |
| Documentation complete | ✅ Done | README, docs/ARCHITECTURE.md, docs/API.md, docs/DEPLOYMENT.md |
| No known critical security issue | ✅ None known | SSRF guard, JWT + rotating refresh tokens, encrypted secrets, rate limiting, validation (details in ARCHITECTURE.md) |
| CI | ✅ Done | GitHub Actions run 43190717966 green: typecheck, backend + web tests, build, Playwright e2e |
| Limitations documented | ✅ Done | This file + README |

## Completed features

- Registration, login, logout. Short-lived access JWT (kept in memory) plus an
  httpOnly refresh cookie; refresh tokens rotate, and reusing an old one
  revokes its whole family.
- Request builder: GET/POST/PUT/PATCH/DELETE, headers, query params, JSON/text
  bodies, and Bearer/Basic/API-key auth.
- Response viewer: status, timing, size, headers, pretty-printed JSON.
- Collections with nested folders and saved requests.
- Environments with `{{variables}}`. Secret values are encrypted with
  AES-256-GCM and never returned to the client.
- Request history, with secrets redacted.
- OpenAPI 3 / Swagger 2 import (JSON or YAML) into a collection.
- Test suites with assertions: status, header, JSONPath, response time, body
  contains, schema.
- Run reports, plus regression comparison between two runs.
- AI test generation. Uses Claude when `ANTHROPIC_API_KEY` is set; otherwise a
  rule-based generator. Generated tests start as drafts, and a human must
  approve them before they run.
- AI/heuristic summary of failures.
- Dashboard with run, pass-rate and latency analytics.
- Realistic demo data via `npm run db:seed` (demo@apiforge.dev / DemoPass123).
- Responsive dark UI, checked at phone width.

## Security measures

- SSRF protection:
  - blocks loopback, private, link-local and metadata addresses;
  - unwraps IPv4-mapped IPv6;
  - re-checks DNS at connect time, so DNS rebinding fails;
  - re-validates every redirect hop and strips credentials when a redirect
    crosses origins.
- Responses are capped at 5 MB and requests time out.
- Every input is validated with Zod; errors go through one central handler and
  never leak stack traces.
- Rate limits on auth endpoints and the request executor.
- Structured logging (pino) with auth headers and cookies redacted.

## Repository

https://github.com/sanikaa12-art/apiforge (branch `main`).

## Docker verification (2026-11-12)

Docker 29.9.3, Compose 5.7.0. A smoke script ran against http://localhost:8080
(nginx → API). Every check passed:
- web index served;
- `/api/health` reported the database up;
- register and `/auth/me` worked;
- executing a request to example.com returned 200;
- SSRF blocked the internal `server` host;
- a suite with an approved case was created, queued, processed by the BullMQ
  worker container and finished COMPLETED (1 passed).

Fixes made during verification:
- `server/Dockerfile`: create `server/node_modules` before the runtime COPY,
  since npm workspaces hoist dependencies.
- `docker-compose.yml`: disable the inherited HTTP healthcheck on the worker.

Run it with: `docker compose --env-file .env.docker up --build -d`.
`.env.docker` holds the generated secrets, is git-ignored and must not be
committed. Demo seed data isn't loaded in the Docker DB (the seed needs dev
dependencies); register a new account instead.

## No paid services required (2026-11-12)

- `AI_PROVIDER` defaults to `local`. Claude is only called when it is set to
  `claude` **and** `ANTHROPIC_API_KEY` is present, so a key left in `.env` never
  triggers a paid call. If Anthropic rejects the key or the account has no
  credits (401/403/billing 400), Claude is disabled for the rest of the process
  and the local generator takes over.
- An earlier live check returned HTTP 400 "credit balance is too low" (request
  `req_011CgxqP4VM61d1ZMD2Mdq6B`). No further paid calls were made.
- Rule-based generator additions:
  - invalid enum values and invalid formats (email, uuid, date, date-time, uri);
  - missing required query parameters;
  - path-parameter traversal/injection;
  - exactly-at-maxLength boundary cases;
  - round-robin category balancing with de-duplication, so small limits still
    cover every category.
  - New unit tests: `server/tests/unit/heuristic.test.ts`.
- Verified 2026-11-12:
  - typecheck and production build pass;
  - 94 backend tests, 9 web tests and 7 Playwright e2e tests pass;
  - a fresh Docker run (`down -v`, `build --no-cache`, `up`) passes the smoke
    test. That includes local test generation (12 tests across all 5
    categories, 6 validation gaps, all drafts), approval, and a run executed by
    the BullMQ worker.
- Deployment: `render.yaml` now uses only free plans (free Postgres, Docker web
  service, static site, no worker or Redis). Trade-offs are in
  docs/DEPLOYMENT.md.

### What genuinely needs a paid service

- **Claude-powered generation and summaries.** Optional; needs Anthropic API
  credits. The free local generator covers the feature.
- **A dedicated background worker on Render.** Render background workers and
  Key Value are paid. On free hosting, jobs run in-process in the API instead,
  which works but limits you to a single API instance.
- **An always-on demo URL.** Free Render web services sleep after ~15 minutes
  idle, and Render's free Postgres expires after 30 days (use free Neon or
  Supabase Postgres to avoid the expiry).

## Setup requirements (external)

| Item | Needed for | Status |
|---|---|---|
| Anthropic API credits | Optional Claude generation only | Not needed. `AI_PROVIDER=local` (default) is free. |
| Hosting account (e.g. Render) | Public deployment via `render.yaml` | Not created. Needs owner authorization. |

## Outstanding tasks

1. Deploy (free tier via `render.yaml`) (only after the owner approves an account).

## Known limitations

- Single-user workspaces only; no team sharing or roles.
- No GraphQL, WebSocket or gRPC requests; HTTP only.
- Request bodies are JSON/text; multipart file upload isn't supported.
- OpenAPI import doesn't resolve external `$ref` files.
- Charts are hand-built SVG and show up to the last 30 days.
