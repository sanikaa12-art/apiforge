import { Router } from "express";
import { z } from "zod";
import { currentUserId } from "../../middleware/auth.js";
import { executeLimiter } from "../../middleware/rateLimit.js";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { httpMethodSchema, keyValueList } from "../../lib/types.js";
import { loadEnvironmentVariables, redactSecrets, substitute, substituteKeyValues } from "../environments/variables.js";
import { getExecutor } from "./executor.js";
import { recordHistory } from "./history.js";

const executeSchema = z.object({
  method: httpMethodSchema,
  url: z.string().trim().min(1, "URL is required").max(8192),
  headers: keyValueList,
  queryParams: keyValueList,
  body: z.string().max(1_000_000).nullish(),
  environmentId: z.string().max(64).nullish(),
  followRedirects: z.boolean().default(true),
});

export const executorRouter = Router();

/** Executes an HTTP request server-side (variables resolved here, never in the browser). */
executorRouter.post("/execute", executeLimiter, async (req, res) => {
  const userId = currentUserId(req);
  const input = executeSchema.parse(req.body);
  const vars = await loadEnvironmentVariables(userId, input.environmentId);
  const unresolved = new Set<string>();
  const url = substitute(input.url, vars.values, unresolved);
  const headers = substituteKeyValues(input.headers, vars.values, unresolved);
  const queryParams = substituteKeyValues(input.queryParams, vars.values, unresolved);
  const body = input.body ? substitute(input.body, vars.values, unresolved) : input.body;

  try {
    const result = await getExecutor().execute({ method: input.method, url, headers, queryParams, body, followRedirects: input.followRedirects });
    const history = await recordHistory({
      userId,
      method: input.method,
      url: result.finalUrl,
      environmentId: input.environmentId,
      secrets: vars.secrets,
      requestHeaders: result.requestHeaders,
      status: result.status,
      durationMs: result.durationMs,
      sizeBytes: result.sizeBytes,
      responseHeaders: result.headers,
      responseBody: result.body,
    });
    res.json({
      historyId: history.id,
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      // Responses can echo secrets back (e.g. httpbin); mask them before they reach the browser.
      body: redactSecrets(result.body, vars.secrets),
      sizeBytes: result.sizeBytes,
      durationMs: result.durationMs,
      truncated: result.truncated,
      redirects: result.redirects.map((r) => redactSecrets(r, vars.secrets)),
      unresolvedVariables: [...unresolved],
    });
  } catch (err) {
    const message = err instanceof AppError ? err.message : "Request failed";
    await recordHistory({ userId, method: input.method, url, environmentId: input.environmentId, secrets: vars.secrets, error: message });
    if (err instanceof AppError && unresolved.size > 0) {
      throw new AppError(err.status, err.code, `${err.message}. Unresolved variables: ${[...unresolved].join(", ")}`);
    }
    throw err;
  }
});

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(64).optional(),
  failedOnly: z.enum(["true", "false"]).optional(),
});

executorRouter.get("/history", async (req, res) => {
  const userId = currentUserId(req);
  const q = historyQuery.parse(req.query);
  const items = await prisma.requestHistory.findMany({
    where: {
      userId,
      ...(q.failedOnly === "true" ? { OR: [{ status: { gte: 400 } }, { error: { not: null } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    select: { id: true, method: true, url: true, status: true, durationMs: true, sizeBytes: true, error: true, createdAt: true, environmentId: true },
  });
  const hasMore = items.length > q.limit;
  res.json({ items: items.slice(0, q.limit), nextCursor: hasMore ? items[q.limit - 1]!.id : null });
});

executorRouter.get("/history/:id", async (req, res) => {
  const item = await prisma.requestHistory.findFirst({ where: { id: req.params.id, userId: currentUserId(req) } });
  if (!item) throw new AppError(404, "NOT_FOUND", "History entry not found");
  res.json(item);
});

executorRouter.delete("/history", async (req, res) => {
  const { count } = await prisma.requestHistory.deleteMany({ where: { userId: currentUserId(req) } });
  res.json({ deleted: count });
});
