# API reference

Base path `/api`. All bodies are JSON. Every route except `/auth/*` and `/health` requires `Authorization: Bearer <accessToken>`.
Errors always have the shape `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "path": "email", "message": "…" }] } }`.

## Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{ email, name, password }` | 201 → `{ user, accessToken }` + refresh cookie |
| POST | `/auth/login` | `{ email, password }` | → `{ user, accessToken }` + refresh cookie |
| POST | `/auth/refresh` | – (cookie) | Rotates the refresh token |
| POST | `/auth/logout` | – (cookie) | 204, revokes the token |
| GET | `/auth/me` | – | Current user |

## Requests & history
| Method | Path | Notes |
|---|---|---|
| POST | `/execute` | `{ method, url, headers[], queryParams[], body?, environmentId?, followRedirects? }` → `{ status, statusText, headers, body, sizeBytes, durationMs, truncated, redirects[], unresolvedVariables[], historyId }`. SSRF violations → 400 `SSRF_BLOCKED`; timeouts → 504; upstream failures → 502 |
| GET | `/history?limit&cursor&failedOnly` | Cursor-paginated |
| GET | `/history/:id` | Full (redacted) entry |
| DELETE | `/history` | Clear history |

`headers` / `queryParams` items: `{ key, value, enabled }`.

## Collections
`GET/POST /collections`, `PATCH/DELETE /collections/:id`, `POST /collections/:id/folders`, `PATCH/DELETE /folders/:id`, `POST /collections/:id/requests`, `GET/PATCH/DELETE /requests/:id`, `POST /requests/:id/duplicate`

## Environments
`GET/POST /environments`, `PATCH/DELETE /environments/:id`, `PUT /environments/:id/variables` with `{ variables: [{ key, value?, isSecret }] }`. Omit `value` on a secret to keep the stored one.

## Test suites
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/suites` | |
| GET/PATCH/DELETE | `/suites/:id` | GET includes cases and the last 20 runs |
| POST | `/suites/:id/cases` | `{ name, method, url, headers, queryParams, body, assertions[], category }` |
| PATCH/DELETE | `/cases/:id` | |
| POST | `/suites/:id/cases/review` | `{ approve: id[], reject: id[] }` |
| POST | `/suites/:id/runs` | 202; runs approved cases in the background |
| GET | `/suites/:id/runs` | |
| GET | `/runs/:id` | Run with results |
| GET | `/runs/:id/compare?baseRunId=` | Regression diff (default: previous completed run) |
| GET | `/runs/:id/report?format=markdown\|json` | Downloadable report |
| POST | `/runs/:id/summarize` | Regenerate the failure summary |

Assertion: `{ type: "status"|"header"|"jsonPath"|"bodyContains"|"responseTime", operator, path?, expected? }`. Operators: `equals, notEquals, lessThan, greaterThan, in, exists, notExists, contains, notContains, type, lengthGreaterThan, matches`.

## AI
| Method | Path | Notes |
|---|---|---|
| GET | `/ai/status` | `{ provider: "claude"\|"heuristic", model }` |
| POST | `/ai/generate-tests` | `{ suiteId, source: { type: "request", requestId } \| { type: "spec", specId, endpointIds? } \| { type: "endpoint", method, url, body? }, categories?, maxPerEndpoint? }` → `{ provider, cases (DRAFT), validationGaps }` |

## OpenAPI
`POST /openapi/preview` and `POST /openapi/import` with `{ content }` or `{ url }`; `GET /openapi/specs`, `GET/DELETE /openapi/specs/:id`.

## Dashboard
`GET /dashboard?days=14` → totals, daily series, per-endpoint stats, recent activity, recent failures.

## Health
`GET /health` → `{ status: "ok", database: "up" }` (503 if the database is unreachable).
