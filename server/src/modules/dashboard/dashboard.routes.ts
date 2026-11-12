import { Router } from "express";
import { z } from "zod";
import { currentUserId } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";

export const dashboardRouter = Router();

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function endpointKey(method: string, url: string) {
  try {
    const u = new URL(url);
    // Collapse ids so /users/42 and /users/43 group together.
    const path = u.pathname.replace(/\/(\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{24})(?=\/|$)/gi, "/:id");
    return `${method} ${u.host}${path}`;
  } catch {
    return `${method} ${url.split("?")[0]}`;
  }
}

dashboardRouter.get("/dashboard", async (req, res) => {
  const userId = currentUserId(req);
  const days = z.coerce.number().int().min(1).max(90).default(14).parse(req.query.days);
  const since = new Date(Date.now() - days * 86_400_000);

  const [totalRequests, rows, runs, collections, suites, environments, recentRuns, failedRequests] = await Promise.all([
    prisma.requestHistory.count({ where: { userId } }),
    prisma.requestHistory.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { method: true, url: true, status: true, durationMs: true, error: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.testRun.findMany({ where: { suite: { userId }, createdAt: { gte: since }, status: "COMPLETED" }, select: { passed: true, failed: true, total: true, createdAt: true } }),
    prisma.collection.count({ where: { userId } }),
    prisma.testSuite.count({ where: { userId } }),
    prisma.environment.count({ where: { userId } }),
    prisma.testRun.findMany({ where: { suite: { userId } }, orderBy: { createdAt: "desc" }, take: 8, include: { suite: { select: { id: true, name: true } } } }),
    prisma.requestHistory.findMany({
      where: { userId, OR: [{ status: { gte: 400 } }, { error: { not: null } }] },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, method: true, url: true, status: true, error: true, durationMs: true, createdAt: true },
    }),
  ]);

  const durations = rows.map((r) => r.durationMs).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const failedInPeriod = rows.filter((r) => r.error || (r.status ?? 0) >= 400).length;
  const testTotals = runs.reduce((acc, r) => ({ passed: acc.passed + r.passed, total: acc.total + r.total }), { passed: 0, total: 0 });

  // Daily series (fill empty days so charts have no gaps)
  const series = new Map<string, { date: string; requests: number; failed: number; totalMs: number; timed: number; testsPassed: number; testsTotal: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    series.set(d, { date: d, requests: 0, failed: 0, totalMs: 0, timed: 0, testsPassed: 0, testsTotal: 0 });
  }
  for (const r of rows) {
    const s = series.get(r.createdAt.toISOString().slice(0, 10));
    if (!s) continue;
    s.requests++;
    if (r.error || (r.status ?? 0) >= 400) s.failed++;
    if (r.durationMs !== null) {
      s.totalMs += r.durationMs;
      s.timed++;
    }
  }
  for (const r of runs) {
    const s = series.get(r.createdAt.toISOString().slice(0, 10));
    if (s) {
      s.testsPassed += r.passed;
      s.testsTotal += r.total;
    }
  }

  // Per-endpoint performance
  const perEndpoint = new Map<string, { durations: number[]; count: number; errors: number }>();
  for (const r of rows) {
    const key = endpointKey(r.method, r.url);
    const e = perEndpoint.get(key) ?? { durations: [], count: 0, errors: 0 };
    e.count++;
    if (r.error || (r.status ?? 0) >= 400) e.errors++;
    if (r.durationMs !== null) e.durations.push(r.durationMs);
    perEndpoint.set(key, e);
  }
  const endpoints = [...perEndpoint.entries()]
    .map(([endpoint, e]) => {
      const sorted = e.durations.sort((a, b) => a - b);
      return {
        endpoint,
        count: e.count,
        errorRate: e.count ? e.errors / e.count : 0,
        avgMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
        p95Ms: percentile(sorted, 95),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const recentActivity = [
    ...rows.slice(0, 10).map((r) => ({ type: "request" as const, title: `${r.method} ${r.url}`, status: r.status, ok: !r.error && (r.status ?? 0) < 400, at: r.createdAt, detail: r.error ?? (r.durationMs !== null ? `${r.durationMs} ms` : null) })),
    ...recentRuns.map((r) => ({ type: "testRun" as const, id: r.id, suiteId: r.suite.id, title: `Ran "${r.suite.name}"`, status: null, ok: r.status === "COMPLETED" && r.failed === 0, at: r.createdAt, detail: r.status === "COMPLETED" ? `${r.passed}/${r.total} passed` : r.status.toLowerCase() })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 12);

  res.json({
    periodDays: days,
    totals: {
      totalRequests,
      requestsInPeriod: rows.length,
      failedInPeriod,
      errorRate: rows.length ? failedInPeriod / rows.length : 0,
      avgResponseMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      p50ResponseMs: percentile(durations, 50),
      p95ResponseMs: percentile(durations, 95),
      testRuns: runs.length,
      testSuccessRate: testTotals.total ? testTotals.passed / testTotals.total : null,
      collections,
      suites,
      environments,
    },
    daily: [...series.values()].map((s) => ({ date: s.date, requests: s.requests, failed: s.failed, avgMs: s.timed ? Math.round(s.totalMs / s.timed) : null, testSuccessRate: s.testsTotal ? s.testsPassed / s.testsTotal : null })),
    endpoints,
    recentActivity,
    failedRequests,
  });
});
