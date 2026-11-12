import { describe, expect, it } from "vitest";
import { registerUser } from "../helpers.js";
import { petstoreYaml } from "../fixtures.js";

describe("OpenAPI import", () => {
  it("previews and imports a spec into a collection, environment and stored spec", async () => {
    const u = await registerUser();
    const preview = await u.post("/api/openapi/preview", { content: petstoreYaml });
    expect(preview.status).toBe(200);
    expect(preview.body.endpoints).toHaveLength(4);

    const imported = await u.post("/api/openapi/import", { content: petstoreYaml });
    expect(imported.status).toBe(201);
    expect(imported.body.endpointCount).toBe(4);

    const collections = (await u.get("/api/collections")).body;
    const col = collections.find((c: { id: string }) => c.id === imported.body.collectionId);
    expect(col.folders.map((f: { name: string }) => f.name).sort()).toEqual(["General", "pets"]);
    expect(col.requests.find((r: { name: string }) => r.name === "Get a pet").url).toBe("{{baseUrl}}/pets/42");

    const envs = (await u.get("/api/environments")).body;
    expect(envs[0].variables[0]).toMatchObject({ key: "baseUrl", value: "https://api.petstore.example.com/v1" });

    // Generate tests for selected endpoints of the stored spec
    const suite = await u.post("/api/suites", { name: "Petstore", environmentId: envs[0].id });
    const gen = await u.post("/api/ai/generate-tests", { suiteId: suite.body.id, source: { type: "spec", specId: imported.body.specId, endpointIds: ["POST /pets"] } });
    expect(gen.status).toBe(201);
    expect(gen.body.cases.length).toBeGreaterThan(5);
    expect(gen.body.validationGaps.length).toBeGreaterThan(0);
  });

  it("returns a helpful error for invalid specs and SSRF-protects spec URLs", async () => {
    const u = await registerUser();
    const bad = await u.post("/api/openapi/preview", { content: "title: not a spec" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/OpenAPI/);
    const ssrf = await u.post("/api/openapi/preview", { url: "http://169.254.169.254/openapi.json" });
    expect(ssrf.body.error.code).toBe("SSRF_BLOCKED");
  });
});

describe("dashboard", () => {
  it("returns empty-state friendly metrics for a new user", async () => {
    const u = await registerUser();
    const res = await u.get("/api/dashboard?days=7");
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ totalRequests: 0, testSuccessRate: null, avgResponseMs: null });
    expect(res.body.daily).toHaveLength(7);
  });

  it("aggregates history into totals, error rate and endpoint stats", async () => {
    const u = await registerUser();
    await u.post("/api/execute", { method: "GET", url: "http://10.0.0.1/" }); // recorded as failed
    const res = await u.get("/api/dashboard");
    expect(res.body.totals.totalRequests).toBe(1);
    expect(res.body.totals.failedInPeriod).toBe(1);
    expect(res.body.failedRequests[0].error).toContain("blocked");
    expect(res.body.recentActivity[0].ok).toBe(false);
  });
});

describe("api basics", () => {
  it("health check and JSON 404s", async () => {
    const u = await registerUser();
    expect((await u.get("/api/health")).body.status).toBe("ok");
    const missing = await u.get("/api/does-not-exist");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });
});
