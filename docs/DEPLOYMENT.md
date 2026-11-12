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

## 2. Render (blueprint included)

1. Push the repository to GitHub.
2. In Render: **New → Blueprint** and select the repo. `render.yaml` creates PostgreSQL, Redis (Key Value), the API, the worker, and the static web app.
3. Set the `sync: false` variables in the dashboard: `ENCRYPTION_KEY` (32 random bytes, base64), `CORS_ORIGIN` (the web app's URL), and optionally `ANTHROPIC_API_KEY`.
4. Change the `/api/*` rewrite destination in `render.yaml` to your API service URL if it differs.

Render's paid plans are needed for the worker and Redis. Check pricing before applying.

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
