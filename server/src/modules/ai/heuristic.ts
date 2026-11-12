/**
 * Rule-based test generator. It needs no external service, so AI test generation
 * keeps working offline and in CI. It reads the endpoint's schema and applies
 * well-known API testing heuristics: happy path, missing required fields, wrong
 * types, boundary values, oversized input, auth, not-found, and robustness.
 */
import type { Assertion } from "../testing/assertions.js";
import type { KeyValue } from "../../lib/types.js";
import { exampleFromSchema, fillPath, successStatus, type EndpointDescriptor, type JsonSchema } from "../openapi/parser.js";
import type { GeneratedTest, GenerationOptions, TestCategory, ValidationGap } from "./types.js";

const CLIENT_ERROR = [400, 422];
const status = (operator: Assertion["operator"], expected: Assertion["expected"]): Assertion => ({ type: "status", operator, expected });
const notServerError: Assertion = status("lessThan", 500);

function bodyProps(ep: EndpointDescriptor): { props: Record<string, JsonSchema>; required: string[]; schema?: JsonSchema } {
  const schema = ep.requestBody?.schema;
  if (!schema || (schema.type && schema.type !== "object" && !schema.properties)) return { props: {}, required: [], schema };
  const merged: JsonSchema = schema.allOf ? Object.assign({}, ...schema.allOf) : schema;
  const props = Object.fromEntries(Object.entries<JsonSchema>(merged.properties ?? {}).filter(([, v]) => !v?.readOnly));
  return { props, required: (merged.required ?? []).filter((r: string) => r in props), schema: merged };
}

export function heuristicForEndpoint(ep: EndpointDescriptor, opts: GenerationOptions, inferred = false): { tests: GeneratedTest[]; gaps: ValidationGap[] } {
  const tests: GeneratedTest[] = [];
  const gaps: ValidationGap[] = [];
  const want = (c: TestCategory) => opts.categories.includes(c);
  const label = `${ep.method} ${ep.path}`;

  const queryParams: KeyValue[] = ep.parameters
    .filter((p) => p.in === "query" && p.required)
    .map((p) => ({ key: p.name, value: String(exampleFromSchema(p.schema, p.name) ?? "1"), enabled: true }));
  const headerParams: KeyValue[] = ep.parameters
    .filter((p) => p.in === "header" && p.required && p.name.toLowerCase() !== "authorization")
    .map((p) => ({ key: p.name, value: String(exampleFromSchema(p.schema, p.name) ?? "value"), enabled: true }));
  const url = `${opts.baseUrl}${fillPath(ep)}`;
  const hasJsonBody = !!ep.requestBody && ep.requestBody.contentType.includes("json");
  const baseHeaders: KeyValue[] = [...headerParams, ...(hasJsonBody ? [{ key: "Content-Type", value: "application/json", enabled: true }] : [])];
  if (ep.secured) baseHeaders.push({ key: "Authorization", value: "Bearer {{authToken}}", enabled: true });
  const example = ep.requestBody ? exampleFromSchema(ep.requestBody.schema) : undefined;
  const exampleBody = example !== undefined && example !== null ? JSON.stringify(example, null, 2) : null;
  const { props, required } = bodyProps(ep);
  const make = (t: Omit<GeneratedTest, "method" | "url" | "headers" | "queryParams"> & Partial<GeneratedTest>): GeneratedTest => ({
    method: ep.method,
    url,
    headers: baseHeaders,
    queryParams,
    ...t,
  });
  const withBody = (mutate: (b: Record<string, unknown>) => void) => {
    const copy = JSON.parse(JSON.stringify(example ?? {})) as Record<string, unknown>;
    mutate(copy);
    return JSON.stringify(copy, null, 2);
  };

  // ---- Positive -------------------------------------------------------------
  if (want("positive")) {
    const ok = successStatus(ep);
    const assertions: Assertion[] = [inferred ? status("lessThan", 400) : status("equals", ok), { type: "responseTime", operator: "lessThan", expected: 2000 }];
    const resp = ep.responses[String(ok)]?.schema;
    if (resp) {
      assertions.push({ type: "header", operator: "contains", path: "content-type", expected: "json" });
      if (resp.type === "array") assertions.push({ type: "jsonPath", operator: "type", path: "$", expected: "array" });
      else {
        const fields: string[] = (resp.required?.length ? resp.required : Object.keys(resp.properties ?? {})).slice(0, 3);
        for (const f of fields) assertions.push({ type: "jsonPath", operator: "exists", path: f });
      }
    }
    tests.push(make({ name: `${ep.summary ?? label} — happy path`, description: `Valid request returns ${inferred ? "a successful status" : ok}${resp ? " with the documented shape" : ""}.`, category: "positive", body: exampleBody, assertions }));
  }

  // ---- Negative -------------------------------------------------------------
  if (want("negative")) {
    if (hasJsonBody) {
      for (const field of required.slice(0, 3)) {
        tests.push(make({ name: `Rejects missing required field "${field}"`, description: `"${field}" is required; omitting it should return a client error, not a 2xx or 5xx.`, category: "negative", body: withBody((b) => delete b[field]), assertions: [status("in", CLIENT_ERROR)] }));
      }
      tests.push(make({ name: "Rejects malformed JSON", description: "A syntactically broken JSON body should be rejected with 400.", category: "negative", body: '{"incomplete": ', assertions: [status("in", [400, 415, 422])] }));
      const typed = Object.entries(props).find(([, s]) => ["string", "integer", "number", "boolean"].includes(s?.type));
      if (typed) {
        const [field, s] = typed;
        const wrong = s.type === "string" ? 12345 : "not-a-number";
        tests.push(make({ name: `Rejects wrong type for "${field}"`, description: `Sending ${typeof wrong} where ${s.type} is expected should fail validation.`, category: "negative", body: withBody((b) => (b[field] = wrong)), assertions: [status("in", CLIENT_ERROR)] }));
      }
      if (ep.requestBody?.required && Object.keys(props).length) {
        tests.push(make({ name: "Rejects empty body", description: "The request body is required.", category: "negative", body: "{}", assertions: [status("in", CLIENT_ERROR)] }));
      }
    }
    const pathParams = ep.parameters.filter((p) => p.in === "path");
    if (pathParams.length && ["GET", "PUT", "PATCH", "DELETE"].includes(ep.method)) {
      const missingPath = ep.path.replace(/\{([^}]+)\}/g, (_m, n: string) => {
        const p = pathParams.find((x) => x.name === n);
        return p?.schema?.type === "integer" || p?.schema?.type === "number" ? "999999999" : "does-not-exist-0000";
      });
      tests.push(make({ name: "Returns 404 for a non-existent resource", description: "Unknown identifiers should produce 404 (or 400 for malformed ids), never 500.", category: "negative", url: `${opts.baseUrl}${missingPath}`, body: exampleBody, assertions: [status("in", [404, 400])] }));
    }
    if (ep.secured) {
      tests.push(make({ name: "Rejects request without credentials", description: "Protected endpoint must require authentication.", category: "security", headers: baseHeaders.filter((h) => h.key.toLowerCase() !== "authorization"), body: exampleBody, assertions: [status("in", [401, 403])] }));
    }
  }

  // ---- Edge cases & validation gaps -----------------------------------------
  for (const [field, s] of Object.entries(props)) {
    if (!s) continue;
    if (s.type === "string" && !s.enum && !s.format) {
      if (typeof s.maxLength === "number") {
        if (want("edge")) tests.push(make({ name: `"${field}" just over maxLength (${s.maxLength + 1} chars)`, description: `Boundary test: maxLength is ${s.maxLength}.`, category: "edge", body: withBody((b) => (b[field] = "a".repeat(s.maxLength + 1))), assertions: [status("in", CLIENT_ERROR)] }));
      } else {
        gaps.push({ endpoint: label, field, issue: `String field "${field}" has no maxLength`, recommendation: `Add a maxLength (e.g. 255) so oversized payloads are rejected early.`, severity: "medium" });
        if (want("validation")) tests.push(make({ name: `Oversized "${field}" should be rejected`, description: "No maxLength is documented; a 10,000-character value probes whether the server validates length.", category: "validation", body: withBody((b) => (b[field] = "x".repeat(10_000))), assertions: [status("in", [400, 413, 422])] }));
      }
      if (required.includes(field) && typeof s.minLength !== "number") {
        gaps.push({ endpoint: label, field, issue: `Required string "${field}" allows an empty value`, recommendation: "Add minLength: 1 to reject empty strings.", severity: "low" });
        if (want("validation")) tests.push(make({ name: `Empty "${field}" should be rejected`, description: "Required strings usually should not be empty.", category: "validation", body: withBody((b) => (b[field] = "")), assertions: [status("in", CLIENT_ERROR)] }));
      }
    }
    if ((s.type === "integer" || s.type === "number") && hasJsonBody) {
      if (typeof s.minimum === "number" && want("edge")) tests.push(make({ name: `"${field}" below minimum (${s.minimum - 1})`, description: `Boundary test: minimum is ${s.minimum}.`, category: "edge", body: withBody((b) => (b[field] = s.minimum - 1)), assertions: [status("in", CLIENT_ERROR)] }));
      if (typeof s.maximum === "number" && want("edge")) tests.push(make({ name: `"${field}" above maximum (${s.maximum + 1})`, description: `Boundary test: maximum is ${s.maximum}.`, category: "edge", body: withBody((b) => (b[field] = s.maximum + 1)), assertions: [status("in", CLIENT_ERROR)] }));
      if (typeof s.minimum !== "number" && typeof s.maximum !== "number") {
        gaps.push({ endpoint: label, field, issue: `Numeric field "${field}" has no minimum/maximum`, recommendation: "Declare a valid range so negative or huge values are rejected.", severity: "medium" });
        if (want("validation")) tests.push(make({ name: `Negative "${field}" should be rejected`, description: "No range is documented; a negative value probes server-side validation.", category: "validation", body: withBody((b) => (b[field] = -1)), assertions: [status("in", CLIENT_ERROR)] }));
      }
    }
  }
  if (hasJsonBody) {
    const firstString = Object.entries(props).find(([, s]) => s?.type === "string" && !s.enum && !s.format)?.[0];
    if (firstString && want("edge")) {
      tests.push(make({ name: `Unicode and emoji in "${firstString}"`, description: "Non-ASCII input must not crash the server.", category: "edge", body: withBody((b) => (b[firstString] = "Zoë Ñúñez 🚀 测试")), assertions: [notServerError] }));
    }
    if (firstString && want("security")) {
      tests.push(make({ name: `Injection-style input in "${firstString}" is handled safely`, description: "SQL/script metacharacters must be treated as data (no 5xx).", category: "security", body: withBody((b) => (b[firstString] = `' OR '1'='1'; --<script>alert(1)</script>`)), assertions: [notServerError] }));
    }
    const { schema } = bodyProps(ep);
    if (schema && Object.keys(props).length) {
      if (!required.length) gaps.push({ endpoint: label, field: null, issue: "Request body declares no required fields", recommendation: "List mandatory properties in `required`.", severity: "high" });
      if (schema.additionalProperties !== false) {
        gaps.push({ endpoint: label, field: null, issue: "Unknown properties are accepted (additionalProperties is not false)", recommendation: "Set additionalProperties: false to prevent mass-assignment bugs.", severity: "low" });
        if (want("security")) tests.push(make({ name: "Unexpected privileged field is ignored or rejected", description: "Mass-assignment probe: sends isAdmin/role fields that are not in the schema.", category: "security", body: withBody((b) => Object.assign(b, { isAdmin: true, role: "admin" })), assertions: [notServerError, { type: "jsonPath", operator: "notEquals", path: "isAdmin", expected: true }] }));
      }
    }
  }
  for (const p of ep.parameters.filter((x) => x.in === "query")) {
    if (/^(limit|per_?page|page_?size|size|page|offset)$/i.test(p.name) && want("edge")) {
      tests.push(make({ name: `Negative "${p.name}" pagination value`, description: "Pagination parameters should validate their range.", category: "edge", queryParams: [...queryParams.filter((q) => q.key !== p.name), { key: p.name, value: "-1", enabled: true }], body: exampleBody, assertions: [notServerError] }));
      if (p.schema && typeof p.schema.maximum !== "number") gaps.push({ endpoint: label, field: p.name, issue: `Pagination parameter "${p.name}" has no maximum`, recommendation: "Cap page size to avoid expensive unbounded queries.", severity: "medium" });
    }
  }
  if (!inferred) {
    if (!Object.keys(ep.responses).some((c) => /^4\d\d$/.test(c))) gaps.push({ endpoint: label, field: null, issue: "No 4xx error responses are documented", recommendation: "Document 400/401/404/422 responses so clients can handle failures.", severity: "medium" });
    if (["POST", "PUT", "PATCH", "DELETE"].includes(ep.method) && !ep.secured) gaps.push({ endpoint: label, field: null, issue: "Write operation has no security requirement", recommendation: "Require authentication for endpoints that modify data.", severity: "high" });
  }

  return { tests: tests.slice(0, opts.maxPerEndpoint), gaps };
}

/** Infers a JSON schema from a sample value — used when there is no OpenAPI spec. */
export function inferSchema(value: unknown): JsonSchema {
  if (Array.isArray(value)) return { type: "array", items: value.length ? inferSchema(value[0]) : {} };
  if (value === null) return { type: "string", nullable: true };
  if (typeof value === "object") {
    const properties = Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, { ...inferSchema(v), example: v }]));
    return { type: "object", properties, required: Object.keys(properties) };
  }
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: "string" };
}

/** Turns an ad-hoc request (method + URL + optional JSON body) into a descriptor the generator understands. */
export function descriptorFromRequest(input: { method: EndpointDescriptor["method"]; url: string; body?: string | null; secured?: boolean }): { descriptor: EndpointDescriptor; baseUrl: string } {
  let baseUrl = "";
  let path = input.url;
  const m = input.url.match(/^((?:https?:\/\/[^/?#]+)|(?:\{\{[^}]+\}\}))(.*)$/);
  if (m) {
    baseUrl = m[1]!;
    path = m[2] || "/";
  }
  const [pathOnly, query = ""] = path.split("?");
  let schema: JsonSchema | undefined;
  if (input.body) {
    try {
      schema = inferSchema(JSON.parse(input.body));
    } catch {
      schema = { type: "string" };
    }
  }
  const parameters: EndpointDescriptor["parameters"] = new URLSearchParams(query).size
    ? [...new URLSearchParams(query).entries()].map(([name, v]) => ({ name, in: "query" as const, required: true, schema: { type: "string", example: v } }))
    : [];
  return {
    baseUrl,
    descriptor: {
      id: `${input.method} ${pathOnly}`,
      method: input.method,
      path: pathOnly + (query && !parameters.length ? `?${query}` : ""),
      tags: [],
      parameters,
      requestBody: schema ? { required: true, contentType: "application/json", schema } : undefined,
      responses: {},
      secured: !!input.secured,
    },
  };
}
