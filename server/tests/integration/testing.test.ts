import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser, startTargetServer } from "../helpers.js";
import { RequestExecutor, setExecutor } from "../../src/modules/executor/executor.js";
import { drainInlineRuns } from "../../src/jobs/queue.js";

let target: Awaited<ReturnType<typeof startTargetServer>>;
beforeAll(async () => {
  target = await startTargetServer();
  setExecutor(new RequestExecutor({ allowlist: ["127.0.0.1"] }, { timeoutMs: 2000, maxBytes: 1024 * 1024, maxRedirects: 3 }));
});
afterAll(async () => {
  await target.close();
  setExecutor(new RequestExecutor());
});

async function runSuite(u: Awaited<ReturnType<typeof registerUser>>, suiteId: string) {
  const started = await u.post(`/api/suites/${suiteId}/runs`);
  expect(started.status).toBe(202);
  await drainInlineRuns();
  return (await u.get(`/api/runs/${started.body.id}`)).body;
}

describe("test suites, AI generation and regression", () => {
  it("generates draft tests, requires approval, runs them and detects regressions", async () => {
    const u = await registerUser();
    const env = await u.post("/api/environments", { name: "Target", variables: [{ key: "baseUrl", value: target.base }] });
    const suite = await u.post("/api/suites", { name: "Posts", environmentId: env.body.id });

    // 1. Generate (no API key in tests → built-in generator)
    const gen = await u.post("/api/ai/generate-tests", {
      suiteId: suite.body.id,
      source: { type: "endpoint", method: "POST", url: "{{baseUrl}}/posts", body: '{"title":"Hello"}' },
      categories: ["positive", "negative"],
    });
    expect(gen.status).toBe(201);
    expect(gen.body.provider).toBe("heuristic");
    expect(gen.body.cases.length).toBeGreaterThanOrEqual(3);
    expect(gen.body.cases.every((c: { status: string }) => c.status === "DRAFT")).toBe(true);

    // 2. Drafts are not executable
    expect((await u.post(`/api/suites/${suite.body.id}/runs`)).status).toBe(400);

    // 3. Review: reject one, approve the rest
    const [rejected, ...approved] = gen.body.cases.map((c: { id: string }) => c.id);
    const review = await u.post(`/api/suites/${suite.body.id}/cases/review`, { approve: approved, reject: [rejected] });
    expect(review.body).toEqual({ approved: approved.length, rejected: 1 });

    // 4. Run: the target validates input, so every generated test passes
    const run1 = await runSuite(u, suite.body.id);
    expect(run1.status).toBe("COMPLETED");
    expect(run1.failed).toBe(0);
    expect(run1.passed).toBe(approved.length);
    expect(run1.summary).toContain("passed");

    // 5. Break validation on the target → negative tests now fail
    target.state.postsValidation = false;
    const run2 = await runSuite(u, suite.body.id);
    target.state.postsValidation = true;
    expect(run2.failed).toBeGreaterThan(0);
    expect(run2.summarySource).toBe("heuristic");
    expect(run2.summary).toContain("Invalid input was accepted");

    // 6. Regression comparison highlights newly introduced failures
    const cmp = await u.get(`/api/runs/${run2.id}/compare`);
    expect(cmp.body.base.id).toBe(run1.id);
    expect(cmp.body.comparison.hasRegressions).toBe(true);
    expect(cmp.body.comparison.counts.newFailure).toBe(run2.failed);
    expect(cmp.body.comparison.entries[0].change).toBe("newFailure");

    // 7. Readable report
    const report = await u.get(`/api/runs/${run2.id}/report`);
    expect(report.headers["content-type"]).toContain("text/markdown");
    expect(report.text).toContain("# Test report — Posts");
    expect(report.text).toContain("❌");
  });

  it("supports manual test cases with every assertion type", async () => {
    const u = await registerUser();
    const suite = await u.post("/api/suites", { name: "Manual" });
    const tc = await u.post(`/api/suites/${suite.body.id}/cases`, {
      name: "Get post 1",
      method: "GET",
      url: `${target.base}/posts/1`,
      assertions: [
        { type: "status", operator: "equals", expected: 200 },
        { type: "header", operator: "contains", path: "content-type", expected: "json" },
        { type: "jsonPath", operator: "equals", path: "title", expected: "Hello" },
        { type: "bodyContains", operator: "contains", expected: "Hello" },
        { type: "responseTime", operator: "lessThan", expected: 1500 },
      ],
    });
    expect(tc.status).toBe(201);
    const run = await runSuite(u, suite.body.id);
    expect(run.results[0].passed).toBe(true);
    expect(run.results[0].assertions).toHaveLength(5);
  });

  it("records network failures as failed results instead of crashing the run", async () => {
    const u = await registerUser();
    const suite = await u.post("/api/suites", { name: "Broken" });
    await u.post(`/api/suites/${suite.body.id}/cases`, { name: "metadata", url: "http://169.254.169.254/", assertions: [{ type: "status", operator: "equals", expected: 200 }] });
    const run = await runSuite(u, suite.body.id);
    expect(run.status).toBe("COMPLETED");
    expect(run.results[0].passed).toBe(false);
    expect(run.results[0].error).toContain("blocked");
    expect(run.summary).toContain("Could not reach the API");
  });

  it("does not let users read other users' runs", async () => {
    const a = await registerUser();
    const b = await registerUser();
    const suite = await a.post("/api/suites", { name: "A" });
    await a.post(`/api/suites/${suite.body.id}/cases`, { name: "x", url: `${target.base}/posts`, assertions: [{ type: "status", operator: "equals", expected: 200 }] });
    const run = await runSuite(a, suite.body.id);
    expect((await b.get(`/api/runs/${run.id}`)).status).toBe(404);
    expect((await b.post(`/api/suites/${suite.body.id}/runs`)).status).toBe(404);
    expect((await b.post("/api/ai/generate-tests", { suiteId: suite.body.id, source: { type: "endpoint", method: "GET", url: "https://x.io" } })).status).toBe(404);
  });
});
