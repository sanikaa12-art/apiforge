import { describe, expect, it } from "vitest";
import { exampleFromSchema, fillPath, normaliseSpec, parseSpecText } from "../../src/modules/openapi/parser.js";
import { heuristicForEndpoint, descriptorFromRequest } from "../../src/modules/ai/heuristic.js";
import { petstoreYaml, swagger2 } from "../fixtures.js";

describe("OpenAPI parsing", () => {
  const spec = normaliseSpec(parseSpecText(petstoreYaml));

  it("extracts metadata, server variables and every operation", () => {
    expect(spec.title).toBe("Petstore");
    expect(spec.baseUrl).toBe("https://api.petstore.example.com/v1");
    expect(spec.endpoints.map((e) => e.id).sort()).toEqual(["GET /health", "GET /pets", "GET /pets/{petId}", "POST /pets"]);
  });
  it("resolves $refs, including circular ones, without hanging", () => {
    const create = spec.endpoints.find((e) => e.id === "POST /pets")!;
    expect(create.requestBody?.schema?.properties?.name?.maxLength).toBe(50);
    expect(JSON.stringify(create.requestBody?.schema)).toContain("circular");
  });
  it("applies path-level params and operation-level security overrides", () => {
    const get = spec.endpoints.find((e) => e.id === "GET /pets/{petId}")!;
    expect(fillPath(get)).toBe("/pets/42");
    expect(get.secured).toBe(true);
    expect(spec.endpoints.find((e) => e.id === "GET /health")!.secured).toBe(false);
  });
  it("parses Swagger 2.0 body parameters", () => {
    const legacy = normaliseSpec(swagger2);
    expect(legacy.baseUrl).toBe("https://legacy.example.com/api");
    expect(legacy.endpoints[0]!.requestBody?.schema?.required).toEqual(["email"]);
  });
  it("rejects documents that are not OpenAPI", () => {
    expect(() => normaliseSpec({ hello: "world" })).toThrow(/OpenAPI/);
    expect(() => parseSpecText("{ not json")).toThrow();
  });
  it("builds realistic examples from schemas", () => {
    expect(exampleFromSchema({ type: "object", properties: { email: { type: "string", format: "email" }, age: { type: "integer", minimum: 18 }, id: { type: "integer", readOnly: true } } })).toEqual({
      email: "jane.doe@example.com",
      age: 30,
    });
  });
});

describe("heuristic test generation", () => {
  const spec = normaliseSpec(parseSpecText(petstoreYaml));
  const opts = { baseUrl: "{{baseUrl}}", maxPerEndpoint: 25, categories: ["positive", "negative", "edge", "validation", "security"] as const };

  it("covers positive, negative, edge, validation and security cases for a POST", () => {
    const { tests, gaps } = heuristicForEndpoint(spec.endpoints.find((e) => e.id === "POST /pets")!, { ...opts, categories: [...opts.categories] });
    const names = tests.map((t) => t.name);
    expect(names.some((n) => n.includes("happy path"))).toBe(true);
    expect(names).toContain('Rejects missing required field "name"');
    expect(names).toContain('"name" just over maxLength (51 chars)');
    expect(names).toContain('"age" below minimum (-1)');
    expect(names).toContain("Rejects request without credentials");
    expect(names).toContain('Oversized "notes" should be rejected');
    expect(tests.find((t) => t.name === "Rejects request without credentials")!.headers.some((h) => h.key === "Authorization")).toBe(false);
    expect(gaps.some((g) => g.field === "notes" && g.issue.includes("maxLength"))).toBe(true);
    const happy = tests[0]!;
    expect(happy.assertions).toContainEqual({ type: "status", operator: "equals", expected: 201 });
    expect(JSON.parse(happy.body!)).toMatchObject({ name: "Jane Doe", species: "dog" });
  });
  it("respects the category filter and max count", () => {
    const { tests } = heuristicForEndpoint(spec.endpoints.find((e) => e.id === "POST /pets")!, { ...opts, categories: ["negative"], maxPerEndpoint: 2 });
    expect(tests).toHaveLength(2);
    expect(tests.every((t) => t.category === "negative" || t.category === "security")).toBe(true);
  });
  it("infers a schema from an ad-hoc request body", () => {
    const { descriptor, baseUrl } = descriptorFromRequest({ method: "POST", url: "https://api.x.io/signup?ref=ad", body: '{"email":"a@b.co","age":3}' });
    expect(baseUrl).toBe("https://api.x.io");
    expect(descriptor.path).toBe("/signup");
    expect(descriptor.requestBody?.schema?.required).toEqual(["email", "age"]);
  });
});
