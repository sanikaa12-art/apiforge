import { Router } from "express";
import { z } from "zod";
import { currentUserId } from "../../middleware/auth.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { prisma, type Prisma } from "../../lib/prisma.js";
import { httpMethodSchema, keyValueList } from "../../lib/types.js";
import { enqueueTestRun } from "../../jobs/queue.js";
import { assertionSchema } from "./assertions.js";
import { compareRuns } from "./compare.js";
import { renderMarkdownReport } from "./report.js";
import { summarizeRun } from "./runner.js";

const suiteSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().max(2000).nullish(),
  environmentId: z.string().max(64).nullish(),
});
const caseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  category: z.enum(["positive", "negative", "edge", "validation", "security"]).default("positive"),
  method: httpMethodSchema.default("GET"),
  url: z.string().trim().min(1).max(8192),
  headers: keyValueList,
  queryParams: keyValueList,
  body: z.string().max(1_000_000).nullish(),
  assertions: z.array(assertionSchema).max(50).default([]),
  status: z.enum(["DRAFT", "APPROVED", "REJECTED"]).optional(),
});

export const testingRouter = Router();

async function ownedSuite(userId: string, id: string) {
  const s = await prisma.testSuite.findFirst({ where: { id, userId } });
  if (!s) throw notFound("Test suite");
  return s;
}
async function assertEnvOwned(userId: string, environmentId?: string | null) {
  if (!environmentId) return;
  const e = await prisma.environment.findFirst({ where: { id: environmentId, userId } });
  if (!e) throw badRequest("Environment not found");
}
async function ownedRun(userId: string, id: string) {
  const run = await prisma.testRun.findFirst({
    where: { id, suite: { userId } },
    include: { suite: { select: { id: true, name: true } }, results: { orderBy: { createdAt: "asc" } } },
  });
  if (!run) throw notFound("Test run");
  return run;
}

const caseData = (d: Partial<z.infer<typeof caseSchema>>) => ({
  ...d,
  headers: d.headers as Prisma.InputJsonValue | undefined,
  queryParams: d.queryParams as Prisma.InputJsonValue | undefined,
  assertions: d.assertions as Prisma.InputJsonValue | undefined,
});

// ---------- Suites ----------
testingRouter.get("/suites", async (req, res) => {
  const suites = await prisma.testSuite.findMany({
    where: { userId: currentUserId(req) },
    orderBy: { updatedAt: "desc" },
    include: {
      environment: { select: { id: true, name: true } },
      _count: { select: { cases: true } },
      runs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, passed: true, failed: true, total: true, createdAt: true } },
    },
  });
  const drafts = await prisma.testCase.groupBy({ by: ["suiteId"], where: { suite: { userId: currentUserId(req) }, status: "DRAFT" }, _count: true });
  const draftMap = new Map(drafts.map((d) => [d.suiteId, d._count]));
  res.json(suites.map((s) => ({ ...s, draftCount: draftMap.get(s.id) ?? 0, lastRun: s.runs[0] ?? null, runs: undefined })));
});

testingRouter.post("/suites", async (req, res) => {
  const userId = currentUserId(req);
  const data = suiteSchema.parse(req.body);
  await assertEnvOwned(userId, data.environmentId);
  res.status(201).json(await prisma.testSuite.create({ data: { ...data, userId } }));
});

testingRouter.get("/suites/:id", async (req, res) => {
  const userId = currentUserId(req);
  await ownedSuite(userId, req.params.id);
  const suite = await prisma.testSuite.findUnique({
    where: { id: req.params.id },
    include: {
      environment: { select: { id: true, name: true, kind: true } },
      cases: { orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] },
      runs: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  res.json(suite);
});

testingRouter.patch("/suites/:id", async (req, res) => {
  const userId = currentUserId(req);
  await ownedSuite(userId, req.params.id);
  const data = suiteSchema.partial().parse(req.body);
  await assertEnvOwned(userId, data.environmentId);
  res.json(await prisma.testSuite.update({ where: { id: req.params.id }, data }));
});

testingRouter.delete("/suites/:id", async (req, res) => {
  await ownedSuite(currentUserId(req), req.params.id);
  await prisma.testSuite.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ---------- Cases ----------
testingRouter.post("/suites/:id/cases", async (req, res) => {
  const suite = await ownedSuite(currentUserId(req), req.params.id);
  const data = caseSchema.parse(req.body);
  const created = await prisma.testCase.create({ data: { ...caseData(data), name: data.name, url: data.url, suiteId: suite.id, status: data.status ?? "APPROVED", source: "MANUAL" } });
  res.status(201).json(created);
});

testingRouter.patch("/cases/:id", async (req, res) => {
  const tc = await prisma.testCase.findFirst({ where: { id: req.params.id, suite: { userId: currentUserId(req) } } });
  if (!tc) throw notFound("Test case");
  const data = caseSchema.partial().parse(req.body);
  res.json(await prisma.testCase.update({ where: { id: tc.id }, data: caseData(data) }));
});

testingRouter.delete("/cases/:id", async (req, res) => {
  const tc = await prisma.testCase.findFirst({ where: { id: req.params.id, suite: { userId: currentUserId(req) } } });
  if (!tc) throw notFound("Test case");
  await prisma.testCase.delete({ where: { id: tc.id } });
  res.status(204).end();
});

/** Human review step for generated tests: approve and/or reject in bulk. */
testingRouter.post("/suites/:id/cases/review", async (req, res) => {
  const suite = await ownedSuite(currentUserId(req), req.params.id);
  const body = z
    .object({ approve: z.array(z.string()).max(500).default([]), reject: z.array(z.string()).max(500).default([]), deleteRejected: z.boolean().default(true) })
    .parse(req.body);
  const approved = await prisma.testCase.updateMany({ where: { suiteId: suite.id, id: { in: body.approve } }, data: { status: "APPROVED" } });
  const rejected = body.deleteRejected
    ? await prisma.testCase.deleteMany({ where: { suiteId: suite.id, id: { in: body.reject }, status: { not: "APPROVED" } } })
    : await prisma.testCase.updateMany({ where: { suiteId: suite.id, id: { in: body.reject } }, data: { status: "REJECTED" } });
  res.json({ approved: approved.count, rejected: rejected.count });
});

// ---------- Runs ----------
testingRouter.post("/suites/:id/runs", async (req, res) => {
  const suite = await ownedSuite(currentUserId(req), req.params.id);
  const approved = await prisma.testCase.count({ where: { suiteId: suite.id, status: "APPROVED" } });
  if (approved === 0) throw badRequest("This suite has no approved test cases to run. Approve some tests first.");
  const run = await prisma.testRun.create({ data: { suiteId: suite.id, total: approved } });
  const mode = await enqueueTestRun(run.id);
  res.status(202).json({ ...run, mode });
});

testingRouter.get("/suites/:id/runs", async (req, res) => {
  const suite = await ownedSuite(currentUserId(req), req.params.id);
  res.json(await prisma.testRun.findMany({ where: { suiteId: suite.id }, orderBy: { createdAt: "desc" }, take: 50 }));
});

testingRouter.get("/runs/:id", async (req, res) => {
  res.json(await ownedRun(currentUserId(req), req.params.id));
});

testingRouter.post("/runs/:id/summarize", async (req, res) => {
  const run = await ownedRun(currentUserId(req), req.params.id);
  if (run.status !== "COMPLETED") throw badRequest("Run has not completed yet");
  res.json(await summarizeRun(run.id));
});

testingRouter.get("/runs/:id/report", async (req, res) => {
  const run = await ownedRun(currentUserId(req), req.params.id);
  const format = z.enum(["markdown", "json"]).default("markdown").parse(req.query.format);
  const filename = `apiforge-report-${run.suite.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${run.id}`;
  if (format === "json") {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.json"`);
    return res.json(run);
  }
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.md"`);
  res.send(renderMarkdownReport(run));
});

/** Regression view: compares a run with a base run (default: the previous completed run). */
testingRouter.get("/runs/:id/compare", async (req, res) => {
  const userId = currentUserId(req);
  const current = await ownedRun(userId, req.params.id);
  const baseRunId = z.string().max(64).optional().parse(req.query.baseRunId);
  const base = baseRunId
    ? await ownedRun(userId, baseRunId)
    : await prisma.testRun.findFirst({
        where: { suiteId: current.suiteId, status: "COMPLETED", createdAt: { lt: current.createdAt } },
        orderBy: { createdAt: "desc" },
        include: { suite: { select: { id: true, name: true } }, results: true },
      });
  if (!base) return res.json({ base: null, current: { id: current.id, createdAt: current.createdAt }, comparison: null });
  if (base.suiteId !== current.suiteId) throw badRequest("Runs belong to different suites");
  res.json({
    base: { id: base.id, createdAt: base.createdAt, passed: base.passed, failed: base.failed, total: base.total },
    current: { id: current.id, createdAt: current.createdAt, passed: current.passed, failed: current.failed, total: current.total },
    comparison: compareRuns(base.results, current.results),
  });
});
