import { prisma, type Prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors.js";
import { asKeyValues } from "../../lib/types.js";
import { getExecutor } from "../executor/executor.js";
import { loadEnvironmentVariables, redactSecrets, substitute, substituteKeyValues } from "../environments/variables.js";
import { describeAssertion, evaluateAll, parseAssertions } from "./assertions.js";
import { summarizeFailures } from "../ai/ai.service.js";

const BODY_PREVIEW = 8 * 1024;

/**
 * Executes every APPROVED test case of a run's suite, sequentially (predictable
 * load on the target API and stable ordering in reports). Draft AI tests are
 * never executed until a human approves them.
 */
export async function executeRun(runId: string): Promise<void> {
  const run = await prisma.testRun.findUnique({ where: { id: runId }, include: { suite: true } });
  if (!run || run.status !== "QUEUED") return;
  const startedAt = new Date();
  await prisma.testRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt } });

  try {
    const cases = await prisma.testCase.findMany({ where: { suiteId: run.suiteId, status: "APPROVED" }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const vars = await loadEnvironmentVariables(run.suite.userId, run.suite.environmentId);
    let passed = 0;

    for (const tc of cases) {
      const unresolved = new Set<string>();
      const url = substitute(tc.url, vars.values, unresolved);
      const headers = substituteKeyValues(asKeyValues(tc.headers), vars.values, unresolved);
      const queryParams = substituteKeyValues(asKeyValues(tc.queryParams), vars.values, unresolved);
      const body = tc.body ? substitute(tc.body, vars.values, unresolved) : null;
      const assertions = parseAssertions(tc.assertions);
      const data: Prisma.TestResultUncheckedCreateInput = { runId, testCaseId: tc.id, name: tc.name, method: tc.method, url: redactSecrets(url, vars.secrets), passed: false };

      try {
        const res = await getExecutor().execute({ method: tc.method, url, headers, queryParams, body });
        const results = evaluateAll(assertions, res);
        const ok = results.length > 0 && results.every((r) => r.passed);
        Object.assign(data, {
          passed: ok,
          status: res.status,
          durationMs: res.durationMs,
          assertions: results.map((r) => ({ ...r, actual: r.actual === undefined ? null : r.actual })) as Prisma.InputJsonValue,
          responseBody: redactSecrets(res.body.slice(0, BODY_PREVIEW), vars.secrets),
          error: results.length === 0 ? "Test has no assertions" : null,
        });
      } catch (err) {
        let message = err instanceof AppError ? err.message : `Unexpected error: ${(err as Error).message}`;
        if (unresolved.size) message += ` (unresolved variables: ${[...unresolved].join(", ")})`;
        Object.assign(data, {
          error: message,
          assertions: assertions.map((a) => ({ assertion: a, passed: false, actual: null, message: `✗ ${describeAssertion(a)} — request failed` })) as Prisma.InputJsonValue,
        });
      }
      if (data.passed) passed++;
      await prisma.testResult.create({ data });
    }

    const failed = cases.length - passed;
    const finishedAt = new Date();
    await prisma.testRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", total: cases.length, passed, failed, finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime() },
    });
    await summarizeRun(runId);
  } catch (err) {
    logger.error({ err, runId }, "Test run failed");
    await prisma.testRun.update({
      where: { id: runId },
      data: { status: "FAILED", error: err instanceof AppError ? err.message : "The test run crashed unexpectedly", finishedAt: new Date() },
    });
  }
}

export async function summarizeRun(runId: string) {
  const run = await prisma.testRun.findUnique({ where: { id: runId }, include: { suite: true, results: { where: { passed: false } } } });
  if (!run) return null;
  const failures = run.results.map((r) => ({
    name: r.name,
    method: r.method,
    url: r.url,
    status: r.status,
    error: r.error,
    failedAssertions: (Array.isArray(r.assertions) ? (r.assertions as { passed: boolean; message: string }[]) : []).filter((a) => !a.passed).map((a) => a.message),
    bodySnippet: r.responseBody?.slice(0, 600) ?? null,
  }));
  const summary = await summarizeFailures(run.suite.name, { total: run.total, passed: run.passed, failed: run.failed }, failures);
  return prisma.testRun.update({ where: { id: runId }, data: { summary: summary.text, summarySource: summary.source } });
}
