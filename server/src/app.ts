import express, { Router } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import crypto from "node:crypto";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { globalLimiter } from "./middleware/rateLimit.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { collectionsRouter } from "./modules/collections/collections.routes.js";
import { environmentsRouter } from "./modules/environments/environments.routes.js";
import { executorRouter } from "./modules/executor/executor.routes.js";
import { testingRouter } from "./modules/testing/testing.routes.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { openapiRouter } from "./modules/openapi/openapi.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (env.TRUST_PROXY) app.set("trust proxy", env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers["x-request-id"] as string) || crypto.randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === "/api/health" },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()), credentials: true }));
  app.use(express.json({ limit: "6mb" }));
  app.use(cookieParser());
  app.use("/api", globalLimiter);

  app.get("/api/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "up", time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: "degraded", database: "down" });
    }
  });

  app.use("/api/auth", authRouter);

  const protectedApi = Router();
  protectedApi.use(requireAuth);
  protectedApi.use(collectionsRouter, environmentsRouter, executorRouter, testingRouter, aiRouter, openapiRouter, dashboardRouter);
  app.use("/api", protectedApi);

  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}
