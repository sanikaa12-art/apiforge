import { describe, expect, it } from "vitest";
import { evaluateAll, evaluateAssertion, getPath, type Assertion } from "../../src/modules/testing/assertions.js";

const res = {
  status: 201,
  headers: { "content-type": "application/json; charset=utf-8", "x-request-id": "abc" },
  body: JSON.stringify({ id: 7, user: { email: "a@b.co", roles: ["admin", "dev"] }, items: [{ id: 1 }, { id: 2 }], active: true, deleted: null }),
  durationMs: 140,
};

describe("getPath", () => {
  const data = JSON.parse(res.body);
  it("reads nested and indexed paths", () => {
    expect(getPath(data, "user.email").value).toBe("a@b.co");
    expect(getPath(data, "items[1].id").value).toBe(2);
    expect(getPath(data, "$.user.roles[0]").value).toBe("admin");
    expect(getPath(data, "items.length").value).toBe(2);
  });
  it("distinguishes missing from null", () => {
    expect(getPath(data, "deleted")).toEqual({ found: true, value: null });
    expect(getPath(data, "nope").found).toBe(false);
  });
});

describe("evaluateAssertion", () => {
  const ok = (a: Assertion) => evaluateAssertion(a, res).passed;
  it("status operators", () => {
    expect(ok({ type: "status", operator: "equals", expected: 201 })).toBe(true);
    expect(ok({ type: "status", operator: "equals", expected: "201" })).toBe(true);
    expect(ok({ type: "status", operator: "in", expected: [200, 201] })).toBe(true);
    expect(ok({ type: "status", operator: "in", expected: "400, 422" })).toBe(false);
    expect(ok({ type: "status", operator: "lessThan", expected: 300 })).toBe(true);
  });
  it("header operators are case-insensitive on the name", () => {
    expect(ok({ type: "header", operator: "contains", path: "Content-Type", expected: "json" })).toBe(true);
    expect(ok({ type: "header", operator: "exists", path: "x-missing" })).toBe(false);
    expect(ok({ type: "header", operator: "notExists", path: "x-missing" })).toBe(true);
  });
  it("jsonPath operators", () => {
    expect(ok({ type: "jsonPath", operator: "equals", path: "id", expected: 7 })).toBe(true);
    expect(ok({ type: "jsonPath", operator: "type", path: "items", expected: "array" })).toBe(true);
    expect(ok({ type: "jsonPath", operator: "contains", path: "user.roles", expected: "dev" })).toBe(true);
    expect(ok({ type: "jsonPath", operator: "lengthGreaterThan", path: "items", expected: 1 })).toBe(true);
    expect(ok({ type: "jsonPath", operator: "matches", path: "user.email", expected: "^[^@]+@[^@]+$" })).toBe(true);
    expect(ok({ type: "jsonPath", operator: "notEquals", path: "active", expected: false })).toBe(true);
  });
  it("response time and body text", () => {
    expect(ok({ type: "responseTime", operator: "lessThan", expected: 200 })).toBe(true);
    expect(ok({ type: "bodyContains", operator: "contains", expected: "admin" })).toBe(true);
  });
  it("produces a readable failure message", () => {
    const r = evaluateAssertion({ type: "status", operator: "equals", expected: 200 }, res);
    expect(r.passed).toBe(false);
    expect(r.message).toContain("got 201");
  });
  it("handles non-JSON bodies gracefully", () => {
    const [r] = evaluateAll([{ type: "jsonPath", operator: "exists", path: "id" }], { ...res, body: "<html>" });
    expect(r!.passed).toBe(false);
    expect(r!.message).toContain("not JSON");
  });
});
