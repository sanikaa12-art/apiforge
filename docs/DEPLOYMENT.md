# Deployment

APIForge is three processes plus two backing services:

| Component | Image / command | Notes |
|---|---|---|
| API | `server/Dockerfile` → `prisma migrate deploy && node dist/index.js` | Stateless; scale horizontally |
| Worker | same image → `node dist/worker.js` | Only when `REDIS_URL` is set |
| Web | `web/Dockerfile` (nginx) **or** any static host serving `web/dist` | Must proxy `/api` to the API (same origin) |
| PostgreSQL 15+ | managed DB recommended | |
| Redis 7 | optional | Enables durable background runs |

> Nothing in this repository deploys automatically. Each option below is a manual step you start yourself.

## 1. Docker Compose (single host)

```bash
cp .env.docker.example .env.docker
```

Fill in `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, and `ENCRYPTION_KEY` (the file shows the commands that generate them). Then:

```bash
docker compose --env-file .env.docker up --build -d
```

Open http://localhost:8080. The runtime image contains only production dependencies, so to load the demo data, run the seed from your machine against the published database port (add `ports: ["5432:5432"]` to the `postgres` service first):

```bash
DATABASE_URL=postgresql://apiforge:<password>@localhost:5432/apiforge ENCRYPTION_KEY=<same key> npm run db:seed
```

## 2. Render — free tier (blueprint included)

Everything in `render.yaml` uses free plans. No paid service is required.

1. Push the repository to GitHub (already done for this project).
2. In Render: **New → Blueprint**, then select the repo. `render.yaml` creates a free
   PostgreSQL database, the API (Docker, free web service) and the web app
   (static site, free).
3. In the dashboard, set the `sync: false` variables on `apiforge-api`:
   - `ENCRYPTION_KEY`: generate it with
     `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   - `CORS_ORIGIN`: the web app's URL, e.g. `https://apiforge-web.onrender.com`.
4. If your API URL differs from `https://apiforge-api.onrender.com`, change the
   `/api/*` rewrite destination in `render.yaml`.
5. Open the web app and register an account. Migrations run automatically when
   the API starts.

Free-tier trade-offs:

| Limitation | Effect | Workaround |
|---|---|---|
| No background worker or Redis (both paid on Render) | Suite runs execute in-process in the API, so only one instance should run | None needed for a demo. Set `REDIS_URL` and add a worker service to scale later. |
| Free web services sleep after about 15 minutes idle | The first request after sleeping takes about a minute | Expected on free plans. |
| Render free Postgres expires after 30 days | The database is deleted | Use a free Neon or Supabase Postgres: remove the `databases` block and set `DATABASE_URL` on `apiforge-api` by hand. |
| AI generation | `AI_PROVIDER=local` uses the built-in rule-based generator (free) | Optional: `AI_PROVIDER=claude` plus `ANTHROPIC_API_KEY` (paid). |

## 3. Any container platform (Fly.io, Railway, ECS, Cloud Run, Kubernetes)

Build both images from the repository root:

```bash
docker build -f server/Dockerfile -t apiforge-api .
```

```bash
docker build -f web/Dockerfile -t apiforge-web .
```

Run the API with the environment variables from `server/.env.example`. The web image's nginx forwards `/api` to `http://server:4000`; edit `web/docker/nginx.conf` if your API has a different internal hostname.

## Production checklist

- [ ] `NODE_ENV=production` (enables `Secure` cookies)
- [ ] Unique, random `JWT_ACCESS_SECRET` (≥ 32 chars) and `ENCRYPTION_KEY` (32 bytes). **Back up `ENCRYPTION_KEY`**: losing it makes stored secrets unreadable.
- [ ] `CORS_ORIGIN` set to the exact web origin
- [ ] `TRUST_PROXY=1` (or the number of proxies) behind a load balancer, so rate limits see real client IPs
- [ ] `SSRF_ALLOWLIST` **empty**
- [ ] HTTPS terminated at the load balancer or CDN
- [ ] Database backups enabled; `prisma migrate deploy` runs on each release (the image does this on start)
- [ ] Logs shipped somewhere searchable (they are JSON in production); filter on `reqId`
- [ ] Health check: `GET /api/health` (checks the database too)
- [ ] Outbound network: the API needs internet egress to reach the APIs users test. Block egress to your internal network at the network layer as well (defence in depth beyond the app-level SSRF guard).
