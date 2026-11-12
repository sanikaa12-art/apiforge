# APIForge

**An API development and testing platform with automated test generation.** Send requests, organise them into collections, switch between environments, import OpenAPI specs, and let the test generator write the tests you forgot about: negative cases, boundary values, and missing-validation probes. Every generated test is reviewed by a human before it runs, and every run is compared with the last one so regressions stand out.

**Runs entirely free and offline.** No API key, paid service or external account is required. Test generation uses a built-in rule-based engine; Claude is an optional, paid add-on that is off by default.

> Portfolio project showing full-stack and backend engineering: a typed React SPA, a modular Express API, PostgreSQL via Prisma, refresh-token auth, an SSRF-hardened HTTP execution engine, background jobs, and a layered test suite (unit → integration → end-to-end).

| | |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Query, React Router |
| **Backend** | Node.js, Express 5, TypeScript, Zod validation, Pino logging |
| **Data** | PostgreSQL, Prisma ORM 7 (migrations included) |
| **Auth** | JWT access tokens (15 min, memory only) + rotating httpOnly refresh cookies with reuse detection |
| **Jobs** | BullMQ + Redis (optional; falls back to in-process execution) |
| **Test generation** | Built-in rule-based generator (default, free, offline); optional Claude (`claude-opus-5-5`) via the Anthropic SDK |
| **Testing** | Vitest + Supertest (98 backend/frontend tests), Playwright (7 E2E flows) |
| **Ops** | Multi-stage Dockerfiles, docker-compose, nginx, GitHub Actions CI, Render blueprint |

---

## Features

| Area | What you can do |
|---|---|
| **Authentication** | Register, sign in, stay signed in across reloads, sign out. Passwords hashed with bcrypt; failed logins are rate-limited. |
| **API client** | GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS, URL + query params (two-way synced), headers, JSON/raw body, *Format JSON*, response status/headers/time/size, pretty or raw JSON with highlighting, request history, ⌘/Ctrl+Enter to send, ⌘/Ctrl+S to save. |
| **Collections** | Create, rename, and delete collections and folders; save, duplicate, move, and reuse requests. |
| **Environments** | Development / Staging / Production / Custom with `{{variables}}`. Substitution happens **on the server**. Secret values are AES-256-GCM encrypted, never returned to the browser, and masked in history and responses. Built-ins: `{{$randomUUID}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomEmail}}`. |
| **Automated testing** | Test suites with assertions on status, headers, JSON paths (`data.items[0].id`), body text, and response time. Runs execute in the background; reports can be downloaded as Markdown or JSON. |
| **OpenAPI** | Paste, upload, or fetch Swagger 2.0 / OpenAPI 3.x (JSON or YAML). Local `$ref`s (including circular ones) are resolved. Import creates a collection (folders per tag, example bodies), an environment with `baseUrl`, and a stored spec for test generation. |
| **Test generation** | Generate from a saved request, an OpenAPI spec (choose endpoints), or an ad-hoc endpoint. Produces positive, negative, edge, validation, and security tests, and lists **missing-validation gaps** (unbounded strings, no numeric ranges, no `required`, undocumented 4xx, unauthenticated writes, mass assignment). Tests arrive as **drafts**: approve, edit, or discard them before anything runs. |
| **Failure summaries** | After each run, failures are grouped and explained in plain language ("Invalid input was accepted", "Server errors", "Auth problems"…), by the built-in summariser (or Claude, if you opt in). |
| **Regression testing** | Every run is compared with the previous one: new failures, fixed, still failing, added, removed, plus duration deltas. New failures are highlighted at the top of the report. |
| **Dashboard** | Total requests, test success rate, failed requests and error rate, p50/p95 latency, requests-per-day and latency charts, per-endpoint performance, recent activity, latest failures. |

Every screen has loading, empty, and error states.

---

## Quick start (local, no Docker needed)

**Requirements:** Node.js 20+ (tested on 24). Nothing else: the dev database is a real PostgreSQL that runs from an npm package.

```bash
npm install
```

```bash
cp server/.env.example server/.env
```

Generate the two secrets and paste them into `server/.env`:

```bash
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(48).toString('base64url')); console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

Start PostgreSQL (keep this terminal open; data lives in `server/.pgdata`):

```bash
npm run db:start
```

In a second terminal, create the tables and load demo data:

```bash
npm run db:migrate && npm run db:seed
```

Start the API (port 4000) and the web app (port 5173):

```bash
npm run dev
```

Open **http://localhost:5173** and sign in with **demo@apiforge.dev / DemoPass123** (or click *Fill in*).

> **What do these commands do?** `npm install` downloads every library both apps need. `db:start` launches PostgreSQL. `db:migrate` runs the SQL files in `server/prisma/migrations` to create tables. `db:seed` inserts a demo user, collections that point at the public JSONPlaceholder and httpbin sandboxes, three environments, a test suite with history, and two weeks of request history. `npm run dev` starts both servers in watch mode, so they restart when you edit code.

### Generating tests (no API key needed)

1. Open **Test Suites** and pick or create a suite.
2. Click **Generate tests**. Choose a source: a saved request, an imported OpenAPI spec (pick endpoints), or an ad-hoc method + URL + JSON body.
3. Pick the categories and the maximum number of tests per endpoint, then click **Generate**.
4. Review the drafts: approve, edit or reject each one. Only approved tests run.
5. Click **Run suite**. You then see the report, the failure summary and a comparison with the previous run.

The generator reads the endpoint's schema, or infers one from a sample body, and applies these rules:
- happy path with response-shape checks;
- missing required body fields and query parameters;
- malformed JSON, wrong types and empty bodies;
- invalid enum values and bad formats (email, uuid, date, uri);
- minLength/maxLength and minimum/maximum boundaries, including exactly-at-limit cases;
- oversized strings and negative numbers;
- Unicode input;
- SQL/XSS-style payloads, path traversal and mass-assignment probes;
- 404s for unknown ids, missing credentials, and pagination abuse.

When the limit is small, it picks tests round-robin across categories, so a few tests still cover positive, negative, security, validation and edge cases. It also lists missing-validation gaps in the schema.

### Optional (paid): use Claude instead

Claude is never called unless you opt in. In `server/.env`:

```
AI_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-api...
```

This needs an Anthropic Console key with API credits. If the key is rejected or the account has no credits, APIForge logs it once, switches to the local generator for the rest of the process and shows a notice in the UI. Leave `AI_PROVIDER=local` (the default) to never make a paid call.

### Alternative: run everything with Docker

Requires Docker Desktop. This starts PostgreSQL, Redis, the API, the BullMQ worker and the web app (nginx):

```bash
cp .env.docker.example .env.docker
```

Fill in `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET` and `ENCRYPTION_KEY` in `.env.docker` (the file shows the commands that generate them), then:

```bash
docker compose --env-file .env.docker up --build -d
```

Open **http://localhost:8080** and register an account. The Docker database starts empty, without the demo seed. To stop the stack (add `-v` to also delete its data):

```bash
docker compose --env-file .env.docker down
```

### Optional: Redis + background worker

Set `REDIS_URL=redis://localhost:6379`, then run `npm run worker` next to the API. Test runs are then queued in BullMQ and executed by the worker (with retries) instead of inside the API process.

---

## Running the tests

| Command | What it runs |
|---|---|
| `npm test -w server` | **94 backend tests**: unit (SSRF classification, assertions, regression diff, variable substitution, encryption, OpenAPI parsing, test generation) and integration (Supertest against a real throwaway PostgreSQL that the test runner starts and deletes). |
| `npm test -w web` | **9 frontend tests**: Vitest + Testing Library for components and formatting helpers. |
| `npm run test:e2e` | **7 Playwright flows** in Chromium: auth redirect, registration + validation, dashboard, sending a request with variables, SSRF blocking, collection CRUD, AI generate → approve → run → report. Needs the dev database running and seeded; Playwright starts the API and web servers itself. Run `npx playwright install chromium` once first. |
| `npm run typecheck` | Strict TypeScript for both apps. |

The integration tests need no setup: `tests/global-setup.ts` starts an embedded PostgreSQL on port 5434, applies migrations, and removes it afterwards. In CI, `TEST_DATABASE_URL` points them at a service container instead.

---

## Project layout

```
apiforge/
├── server/                     Express API (TypeScript, ESM)
│   ├── prisma/                 schema.prisma, migrations/, seed.ts
│   ├── src/
│   │   ├── config/env.ts       validated configuration (fails fast)
│   │   ├── lib/                prisma client, logger, errors, crypto, shared types
│   │   ├── middleware/         auth (JWT), centralized error handler, rate limits
│   │   ├── jobs/queue.ts       BullMQ queue / in-process fallback
│   │   ├── modules/
│   │   │   ├── auth/           register, login, refresh rotation, logout
│   │   │   ├── collections/    collections, folders, saved requests
│   │   │   ├── environments/   environments, encrypted variables, substitution
│   │   │   ├── executor/       SSRF guard, HTTP engine, history
│   │   │   ├── testing/        assertions, runner, regression diff, reports
│   │   │   ├── openapi/        spec parser + importer
│   │   │   ├── ai/             Claude provider, heuristic generator, summaries
│   │   │   └── dashboard/      aggregated metrics
│   │   ├── app.ts / index.ts / worker.ts
│   └── tests/                  unit/, integration/, fixtures, global-setup
├── web/                        React SPA
│   ├── src/{pages,components,lib}
│   └── e2e/                    Playwright specs
├── docs/                       ARCHITECTURE.md, DEPLOYMENT.md, API.md
├── docker-compose.yml          postgres + redis + api + worker + web
└── .github/workflows/ci.yml
```

## Documentation

- [Architecture & design decisions](docs/ARCHITECTURE.md): request flow, data model, security model (SSRF, auth, secrets), AI pipeline, trade-offs
- [Deployment](docs/DEPLOYMENT.md): Docker Compose, Render free tier, any container host; production checklist
- [API reference](docs/API.md): every endpoint

## Configuration

All settings are environment variables, validated at startup (`server/src/config/env.ts`). See [`server/.env.example`](server/.env.example) for the full list with explanations. Never commit real secrets: `.env` files are git-ignored.

## License

MIT
