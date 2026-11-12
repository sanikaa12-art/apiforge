import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { redisConnection, TEST_RUN_QUEUE } from "./jobs/queue.js";
import { executeRun } from "./modules/testing/runner.js";

if (!env.REDIS_URL) {
  logger.error("REDIS_URL is not set — the worker is only needed when using Redis. Runs execute in-process otherwise.");
  process.exit(1);
}

const worker = new Worker<{ runId: string }>(TEST_RUN_QUEUE, async (job) => executeRun(job.data.runId), { connection: redisConnection(), concurrency: 4 });
worker.on("completed", (job) => logger.info({ runId: job.data.runId }, "Test run completed"));
worker.on("failed", (job, err) => logger.error({ runId: job?.data.runId, err }, "Test run job failed"));
logger.info("APIForge worker listening for test runs");

const shutdown = async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
