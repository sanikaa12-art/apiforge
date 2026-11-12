import { Router } from "express";
import { z } from "zod";
import { currentUserId } from "../../middleware/auth.js";
import { aiLimiter } from "../../middleware/rateLimit.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { prisma, type Prisma } from "../../lib/prisma.js";
import { asKeyValues, httpMethodSchema } from "../../lib/types.js";
import type { EndpointDescriptor } from "../openapi/parser.js";
import { aiStatus, generateTests } from "./ai.service.js";
import { descriptorFromRequest } from "./heuristic.js";
import type { TestCategory } from "./types.js";

const categories = z.enum(["positive", "negative", "edge", "validation", "security"]);
const generateSchema = z.object({
  suiteId: z.string().max(64),
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("request"), requestId: z.string().max(64) }),
    z.object({ type: z.literal("spec"), specId: z.string().max(64), endpointIds: z.array(z.string().max(300)).max(50).optional() }),
    z.object({ type: z.literal("endpoint"), method: httpMethodSchema, url: z.string().min(1).max(8192), body: z.string().max(100_000).nullish(), secured: z.boolean().optional() }),
  ]),
  categories: z.array(categories).min(1).default(["positive", "negative", "edge", "validation", "security"]),
  maxPerEndpoint: z.number().int().min(1).max(25).default(12),
  baseUrl: z.string().max(2000).optional(),
});

export const aiRouter = Router();

aiRouter.get("/ai/status", (_req, res) => {
  res.json(aiStatus());
});

/**
 * Generates test cases and stores them as DRAFTs. Drafts are never executed until
 * a user reviews and approves them (POST /suites/:id/cases/review).
 */
aiRouter.post("/ai/generate-tests", aiLimiter, async (req, res) => {
  const userId = currentUserId(req);
  const input = generateSchema.parse(req.body);
  const suite = await prisma.testSuite.findFirst({ where: { id: input.suiteId, userId } });
  if (!suite) throw notFound("Test suite");

  let endpoints: EndpointDescriptor[];
  let baseUrl = input.baseUrl ?? "{{baseUrl}}";
  let inferred = false;
  let extraHeaders: { key: string; value: string; enabled: boolean }[] = [];

  if (input.source.type === "spec") {
    const spec = await prisma.apiSpec.findFirst({ where: { id: input.source.specId, userId } });
    if (!spec) throw notFound("API specification");
    const all = spec.endpoints as unknown as EndpointDescriptor[];
    endpoints = input.source.endpointIds?.length ? all.filter((e) => input.source.type === "spec" && input.source.endpointIds!.includes(e.id)) : all.slice(0, 15);
  } else {
    let method, url, body;
    if (input.source.type === "request") {
      const r = await prisma.savedRequest.findFirst({ where: { id: input.source.requestId, collection: { userId } } });
      if (!r) throw notFound("Saved request");
      ({ method, url, body } = r);
      extraHeaders = asKeyValues(r.headers).filter((h) => h.enabled && h.key.toLowerCase() !== "content-type");
    } else ({ method, url, body } = input.source);
    const secured = extraHeaders.some((h) => h.key.toLowerCase() === "authorization") || (input.source.type === "endpoint" && !!input.source.secured);
    const d = descriptorFromRequest({ method, url, body, secured });
    endpoints = [d.descriptor];
    if (!input.baseUrl) baseUrl = d.baseUrl;
    inferred = true;
  }
  if (!endpoints.length) throw badRequest("No endpoints selected");

  const result = await generateTests(endpoints, { baseUrl, maxPerEndpoint: input.maxPerEndpoint, categories: input.categories as TestCategory[] }, inferred);

  const maxOrder = await prisma.testCase.aggregate({ where: { suiteId: suite.id }, _max: { sortOrder: true } });
  let order = (maxOrder._max.sortOrder ?? 0) + 1;
  const created = await prisma.$transaction(
    result.tests.map((t) => {
      const headers = [...t.headers];
      for (const h of extraHeaders) if (!headers.some((x) => x.key.toLowerCase() === h.key.toLowerCase())) headers.push(h);
      // Tests that deliberately drop credentials must stay without them.
      const finalHeaders = t.category === "security" && t.name.toLowerCase().includes("without credentials") ? headers.filter((h) => h.key.toLowerCase() !== "authorization") : headers;
      return prisma.testCase.create({
        data: {
          suiteId: suite.id,
          name: t.name,
          description: t.description,
          category: t.category,
          method: t.method,
          url: t.url,
          headers: finalHeaders as Prisma.InputJsonValue,
          queryParams: t.queryParams as Prisma.InputJsonValue,
          body: t.body,
          assertions: t.assertions as Prisma.InputJsonValue,
          status: "DRAFT",
          source: result.provider === "claude" ? "AI" : "HEURISTIC",
          sortOrder: order++,
        },
      });
    }),
  );
  res.status(201).json({ provider: result.provider, model: result.model ?? null, notice: result.notice ?? null, cases: created, validationGaps: result.validationGaps });
});
