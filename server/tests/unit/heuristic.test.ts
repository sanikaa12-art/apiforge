import { describe, expect, it } from "vitest";
import { heuristicForEndpoint, pickBalanced } from "../../src/modules/ai/heuristic.js";
import { aiStatus, generateTests } from "../../src/modules/ai/ai.service.js";
import type { EndpointDescriptor } from "../../src/modules/openapi/parser.js";
import type { GeneratedTest, GenerationOptions } from "../../src/modules/ai/types.js";

const all: GenerationOptions["categories"] = ["positive", "negative", "edge", "validation", "security"];
const opts = (max = 50): GenerationOptions => ({ baseUrl: "https://api.example.com", maxPerEndpoint: max, categories: all });

const createUser: EndpointDescriptor = {
  id: "POST /orgs/{orgId}/users",
  method: "POST",
  path: "/orgs/{orgId}/users",
  summary: "Create user",
  tags: [],
  secured: true,
  parameters: [
    { name: "orgId", in: "path", required: true, schema: { type: "integer" } },
    { name: "dryRun", in: "query", required: true, schema: { type: "boolean" } },
  ],
  requestBody: {
    required: true,
    contentType: "application/json",
    schema: {
      type: "object",
      required: ["email", "name", "role"],
      properties: {
        email: { type: "string", format: "email" },
        name: { type: "string", minLength: 1, maxLength: 50 },
        role: { type: "string", enum: ["admin", "member"] },
        age: { type: "integer", minimum: 0, maximum: 150 },
      },
    },
  },
  responses: { "201": { description: "Created" }, "400": { description: "Bad request" } },
};

describe("rule-based generator", () => {
  const { tests } = heuristicForEndpoint(createUser, opts());
  const names = tests.map((t) => t.name);

  it("covers enum, format, query, path and boundary rules", () => {
    expect(names).toContain('Rejects value outside enum for "role"');
    expect(names).toContain('Rejects invalid email in "email"');
    expect(names).toContain('Rejects missing required query parameter "dryRun"');
    expect(names).toContain('Traversal/injection in path parameter "orgId"');
    expect(names).toContain('"name" exactly at maxLength (50 chars) is accepted');
    expect(names).toContain('"name" just over maxLength (51 chars)');
    expect(names).toContain('"age" above maximum (151)');
  });

  it("produces runnable requests with bodies that differ from the happy path", () => {
    const happy = tests.find((t) => t.category === "positive")!;
    const enumCase = tests.find((t) => t.name.includes("outside enum"))!;
    expect(JSON.parse(happy.body!).role).toMatch(/admin|member/);
    expect(JSON.parse(enumCase.body!).role).toBe("__not_an_allowed_value__");
    const missingQuery = tests.find((t) => t.name.includes("missing required query"))!;
    expect(missingQuery.queryParams.some((q) => q.key === "dryRun")).toBe(false);
    expect(tests.find((t) => t.name.includes("Traversal"))!.url).toContain("..%2F");
  });

  it("keeps category coverage when the limit is small", () => {
    const small = heuristicForEndpoint(createUser, opts(5)).tests;
    expect(small).toHaveLength(5);
    expect(new Set(small.map((t) => t.category))).toEqual(new Set(all));
  });

  it("pickBalanced drops duplicate names", () => {
    const t = (name: string, category: GeneratedTest["category"]) => ({ name, category }) as GeneratedTest;
    expect(pickBalanced([t("a", "edge"), t("a", "edge"), t("b", "positive")], 10).map((x) => x.name)).toEqual(["b", "a"]);
  });
});

describe("AI service without a paid provider", () => {
  it("uses the local generator by default and reports no paid dependency", async () => {
    expect(aiStatus()).toMatchObject({ provider: "heuristic", model: null });
    const r = await generateTests([createUser], opts(10));
    expect(r.provider).toBe("heuristic");
    expect(r.tests.length).toBe(10);
    expect(r.validationGaps.length).toBeGreaterThanOrEqual(0);
  });
});
