/**
 * Background execution of test runs.
 *
 * - With REDIS_URL set: runs are pushed to a BullMQ queue and executed by a
 *   separate worker process (`npm run worker`). This survives API restarts,
 *   spreads load, and retries crashed jobs.
 * - Without Redis: runs execute in-process right after the HTTP response is
 *   sent. Good enough for local development and small deployments.
 */
import { Queue } from "bullmq";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { executeRun } from "../modules/testing/runner.js";

export const TEST_RUN_QUEUE = "test-runs";
let queue: Queue | undefined;

export function redisConnection() {
  const url = new URL(env.REDIS_URL!);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

const inFlight = new Set<Promise<void>>();

export async function enqueueTestRun(runId: string): Promise<"queue" | "inline"> {
  if (env.REDIS_URL) {
    queue ??= new Queue(TEST_RUN_QUEUE, { connection: redisConnection() });
    await queue.add("run", { runId }, { jobId: runId, attempts: 2, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 1000, removeOnFail: 1000 });
    return "queue";
  }
  const p = executeRun(runId)
    .catch((err) => logger.error({ err, runId }, "Inline test run crashed"))
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
  return "inline";
}

/** Used by tests and graceful shutdown to wait for in-process runs. */
export async function drainInlineRuns() {
  await Promise.all([...inFlight]);
}

export async function closeQueue() {
  await queue?.close();
}
