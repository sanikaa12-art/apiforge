# Architecture

## Overview

```
 Browser (React SPA)                      API (Express)                         Data
┌───────────────────────┐  /api (same   ┌──────────────────────────────┐   ┌──────────────┐
│ Pages ─ TanStack Query │──origin)─────▶│ helmet · cors · pino-http    │   │ PostgreSQL   │
│ access token in memory │               │ rate limits · JSON parser    │──▶│ (Prisma)     │
│ refresh = httpOnly     │◀──────────────│ requireAuth (JWT)            │   └──────────────┘
│ cookie                 │               │ modules/* routers            │   ┌──────────────┐
└───────────────────────┘               │ centralized error handler    │──▶│ Redis/BullMQ │◀─ worker.ts
                                         └──────┬───────────────────────┘   └──────────────┘
                                                │ SSRF-guarded HTTP engine (undici)
                                                ▼
                                         Third-party APIs being tested
                                                │ (optional) Anthropic API
```

The API is a **modular monolith**: each feature lives in `server/src/modules/<feature>` with its routes and services. Modules share only `lib/` (database, errors, crypto, logging) and a few explicit service functions (for example, the test runner uses the executor). This keeps each feature easy to find and test without the operational cost of microservices.

## Request lifecycle

1. `pino-http` assigns a request id (or reuses `X-Request-Id`) and logs the request, with `Authorization` and cookies redacted.
2. `helmet` sets security headers; `cors` allows only `CORS_ORIGIN`; a global rate limit applies.
3. `requireAuth` verifies the HS256 access token (issuer, audience, and algorithm pinned) and sets `req.user`.
4. The route parses input with a **Zod** schema. Invalid input throws a `ZodError`.
5. Every query is scoped by owner (`where: { id, userId }` or `collection: { userId }`). Another user's id returns **404, not 403**, so resource existence isn't leaked.
6. Errors propagate (Express 5 forwards async rejections) to **one error handler**, which maps Zod, `AppError`, and Prisma errors to `{ error: { code, message, details? } }` and logs unexpected ones without leaking internals.

## Data model

```
User ─┬─< RefreshToken            (hashed, familyId for rotation)
      ├─< Collection ─┬─< Folder (self-referencing tree)
      │               └─< SavedRequest ── Folder?
      ├─< Environment ─< EnvironmentVariable (isSecret → AES-GCM ciphertext)
      ├─< RequestHistory           (redacted snapshot of each execution)
      ├─< ApiSpec                  (raw spec + normalised endpoint list)
      └─< TestSuite ─┬─< TestCase  (status DRAFT/APPROVED/REJECTED, source MANUAL/AI/HEURISTIC)
                     └─< TestRun ─< TestResult (assertion results JSON)
```

Headers, query params, and assertions are stored as JSON columns: they are always read and written as a unit, never queried individually. Every foreign key cascades on delete, so deleting a user or suite cleans up fully. Indexes cover the hot paths (`userId, createdAt` on history; `suiteId, createdAt` on runs).

## Security model

### SSRF protection (`modules/executor/ssrf.ts`, `executor.ts`)

The execution engine makes HTTP requests **from our server** to user-supplied URLs, the classic SSRF setup. Defence in depth:

| Layer | What it stops |
|---|---|
| Scheme allow-list (`http`, `https`) | `file://`, `gopher://`, `ftp://`… |
| Hostname deny-list (`localhost`, `*.localhost`, `*.local`, `*.internal`, `metadata.google.internal`, k8s service names) | Name-based internal targets |
| **IP classification with ipaddr.js; only `unicast` passes** | Loopback, RFC 1918 private, link-local (incl. **169.254.169.254** cloud metadata), CGNAT (incl. Alibaba's **100.100.100.200**), unique-local IPv6 (incl. AWS **fd00:ec2::254**), multicast, reserved, unspecified, and IPv6 forms that embed IPv4 (mapped `::ffff:`, NAT64, 6to4, Teredo) |
| URL normalisation via WHATWG `URL` | Decimal/hex/octal tricks (`http://2130706433`, `0x7f.1`, `0177.0.0.1`) become `127.0.0.1` before checks |
| **DNS validated before and at connect time** | `assertSafeUrl` resolves and checks every A/AAAA record, then the undici `Agent`'s custom `lookup` re-resolves and re-checks inside the socket connect. The IP we connect to is the IP we checked, which closes **DNS rebinding** (TOCTOU) |
| **Manual redirects** | Each `Location` hop goes through every check again; max `MAX_REDIRECTS`; `Authorization`/`Cookie` are dropped on cross-origin hops; 303 (and 301/302 after POST) become GET |
| Resource limits | Connect/header/body timeouts, a 5 MB response cap (streamed, then truncated), forbidden hop-by-hop headers, CR/LF injection rejected |

The same engine fetches OpenAPI specs by URL, and the OpenAPI `$ref` resolver only follows **local** references, so a spec can't trigger outbound requests either. `SSRF_ALLOWLIST` exists for local development (for example, to test an API on `localhost`) and logs a warning if set in production.

### Authentication

- **Access token:** JWT, 15 minutes, kept **in memory** in the SPA (not `localStorage`), so an XSS bug can't steal a long-lived credential.
- **Refresh token:** 48 random bytes in an **httpOnly, SameSite=Strict, Secure (prod), Path=/api/auth** cookie; only its SHA-256 hash is stored.
- **Rotation with reuse detection:** each refresh revokes the presented token and issues a new one in the same *family*. Presenting a revoked token means it was copied, so the whole family is revoked. A conditional `updateMany … where revokedAt = null` makes concurrent refreshes safe.
- **Passwords:** bcrypt (cost 12). Unknown emails take the same time and return the same message as wrong passwords, so there's no user enumeration.
- **Rate limits:** global 600/min/IP; 20 *failed* auth attempts per 15 min/IP; 120 executions/min/user; 20 AI calls/min/user.

### Secrets

- Environment variables marked secret are encrypted with **AES-256-GCM** (random IV, auth tag; tampering is detected) using `ENCRYPTION_KEY`.
- The API **never returns** secret values. The client gets `hasValue: true`, and saving without a new value keeps the stored ciphertext.
- Substitution happens **server-side**. Before anything is persisted or returned, secret values are masked (raw and URL-encoded) in history URLs, headers, and bodies, in test results, and even in response bodies that echo them back (e.g. httpbin). Sensitive headers (`Authorization`, `Cookie`, `X-API-Key`…) are always stored as `[REDACTED]`.
- Nothing secret is sent to the AI provider: it receives endpoint *shapes* and already-redacted failure messages.

## Test execution pipeline

```
POST /suites/:id/runs ──▶ TestRun(QUEUED) ──▶ enqueueTestRun
                                              ├─ REDIS_URL set → BullMQ job → worker.ts
                                              └─ otherwise     → in-process promise
executeRun: RUNNING → for each APPROVED case (sequential):
              substitute vars → SSRF-safe execute → evaluate assertions → TestResult
           → COMPLETED (counts, duration) → summarise failures (Claude | heuristic)
```

Cases run **sequentially** so load on the target API is predictable and reports stay stably ordered. A failure in one case (DNS, timeout, SSRF block) becomes a failed result, not a crashed run. The UI polls the run every second while it is queued or running.

**Regression comparison** (`testing/compare.ts`) is a pure function. It matches results by test case id (falling back to name) and classifies each as `newFailure | fixed | stillFailing | stillPassing | added | removed`, with duration deltas. That makes it easy to unit-test.

## AI pipeline

```
source ─┬─ saved request / ad-hoc endpoint ──▶ infer schema from example body ─┐
        └─ OpenAPI spec (selected endpoints) ──────────────────────────────────┤
                                                                               ▼
              AI_PROVIDER=claude + key (opt-in)? ── yes ─▶ Claude (structured output, Zod schema)
                                              │                         │ error/refusal (401/403/no credits
                                              │                         │ also disables Claude for the process)
                                   no (default) ◀──────────────────────┘
                                              ▼
                                  heuristic generator (rules) ──▶ TestCase[status = DRAFT] + validation gaps
                                                                      │ human review
                                                                      ▼
                                                             APPROVED → runnable
```

- **Claude provider** (`ai/claude.ts`): `claude-opus-5-5` with structured outputs (`betaZodOutputFormat`), so responses are schema-valid JSON. Every generated assertion is re-validated with the app's own Zod schema, and invalid ones are dropped. Server-side refusal fallbacks are enabled (`fallbacks: "default"`).
- **Heuristic provider** (`ai/heuristic.ts`): deterministic and free. It covers the happy path with the documented response shape, missing required fields, malformed JSON, wrong types, empty bodies, not-found ids, missing credentials, maxLength+1, min−1/max+1, oversized strings, empty required strings, negative numbers, unicode, injection-style strings, mass-assignment probes, and pagination abuse. It also reports schema **validation gaps**.
- **Human in the loop:** generated tests are always `DRAFT`. Running a suite only executes `APPROVED` cases, and the API enforces this.

## Frontend

- **Routing:** React Router with lazy-loaded pages; `Protected` restores the session from the refresh cookie on load.
- **Server state:** TanStack Query handles caching, invalidation after mutations, and polling for running test runs.
- **API client** (`lib/api.ts`): adds the bearer token, retries once after a transparent refresh on 401, and turns errors into a typed `ApiError` with field details for forms.
- **Design system:** Tailwind v4 `@theme` tokens (surfaces, text tiers, accent, status colours, HTTP method colours), Inter + JetBrains Mono, and hand-rolled primitives (`components/ui.tsx`). Charts are hand-built SVG with hover tooltips; the palette was checked for colour-vision-deficiency separation.
- **Vite dev proxy / nginx in production:** the browser only ever talks to its own origin, which is what lets the SameSite=Strict refresh cookie work.

## Key trade-offs

| Decision | Why | Cost |
|---|---|---|
| Modular monolith | One deployable, shared transactions, easy local dev | Must keep module boundaries disciplined |
| JSON columns for headers/assertions | Always read/written whole; flexible schema | Can't index or query inside them efficiently |
| Sequential test execution | Predictable load, stable reports | Large suites take longer; concurrency is a config-level change |
| Redis optional | Zero-dependency local dev | In-process runs are lost if the API restarts mid-run |
| Vitest for backend *and* frontend instead of Vitest + Jest | One runner, one config style, Jest-compatible API, native ESM/TS | No Jest-specific plugins |
| Embedded PostgreSQL for dev/tests | No Docker required; tests use a real Postgres, not SQLite or mocks | ~40 MB binary download on install |
