import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { closeQueue, drainInlineRuns } from "./jobs/queue.js";
import { aiStatus } from "./modules/ai/ai.service.js";

const server = createApp().listen(env.PORT, () => {
  const ai = aiStatus();
  logger.info(`APIForge API listening on http://localhost:${env.PORT}`);
  logger.info(`Jobs: ${env.REDIS_URL ? "BullMQ (Redis)" : "in-process"} · AI: ${ai.provider}${ai.model ? ` (${ai.model})` : ""}`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close();
  await drainInlineRuns();
  await closeQueue();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
