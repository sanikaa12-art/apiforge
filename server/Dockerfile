# syntax=docker/dockerfile:1
# Build context: repository root (needed for the npm workspace lockfile).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace server --include-workspace-root=false --ignore-scripts
COPY server/ server/
# Prisma only needs a syntactically valid URL to generate the client.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build -w server
# Workspaces hoist most deps to /app/node_modules; server/node_modules may not
# exist, so create it to keep the runtime COPY below valid either way.
RUN npm prune --omit=dev --workspace server && mkdir -p server/node_modules

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/server/node_modules ./server/node_modules
COPY --from=build --chown=app:app /app/server/dist ./server/dist
COPY --from=build --chown=app:app /app/server/prisma ./server/prisma
COPY --from=build --chown=app:app /app/server/prisma.config.ts /app/server/package.json ./server/
WORKDIR /app/server
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://localhost:4000/api/health || exit 1
# Apply pending migrations, then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
