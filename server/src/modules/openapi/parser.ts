import YAML from "yaml";
import { badRequest } from "../../lib/errors.js";
import type { HttpMethodName } from "../../lib/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type JsonSchema = Record<string, any>;

export interface EndpointParam {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema?: JsonSchema;
  description?: string;
}

export interface EndpointDescriptor {
  id: string; // "POST /users"
  method: HttpMethodName;
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  tags: string[];
  parameters: EndpointParam[];
  requestBody?: { required: boolean; contentType: string; schema?: JsonSchema };
  responses: Record<string, { description?: string; schema?: JsonSchema }>;
  secured: boolean;
}

export interface ParsedSpec {
  title: string;
  version?: string;
  specVersion: string;
  baseUrl?: string;
  endpoints: EndpointDescriptor[];
  securitySchemes: Record<string, JsonSchema>;
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
const MAX_SPEC_BYTES = 5 * 1024 * 1024;

export function parseSpecText(text: string): any {
  if (text.length > MAX_SPEC_BYTES) throw badRequest("Specification is larger than 5 MB");
  const trimmed = text.trim();
  if (!trimmed) throw badRequest("Specification is empty");
  try {
    return trimmed.startsWith("{") ? JSON.parse(trimmed) : YAML.parse(trimmed, { maxAliasCount: 100 });
  } catch (e) {
    throw badRequest(`Could not parse specification as JSON or YAML: ${(e as Error).message.split("\n")[0]}`);
  }
}

/** Resolves local "#/..." references only. Remote refs are ignored on purpose (no fetching = no SSRF surface). */
function makeResolver(root: any) {
  const lookup = (ref: string): any => {
    if (!ref.startsWith("#/")) return undefined;
    return ref
      .slice(2)
      .split("/")
      .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce<any>((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), root);
  };
  const resolve = (node: any, seen: string[] = [], depth = 0): any => {
    if (depth > 12) return { type: "object", description: "(depth limit)" };
    if (Array.isArray(node)) return node.map((n) => resolve(n, seen, depth + 1));
    if (!node || typeof node !== "object") return node;
    if (typeof node.$ref === "string") {
      if (seen.includes(node.$ref)) return { type: "object", description: `(circular ${node.$ref})` };
      const target = lookup(node.$ref);
      if (target === undefined) return { description: `(unresolved ${node.$ref})` };
      return resolve(target, [...seen, node.$ref], depth + 1);
    }
    const out: any = {};
    for (const [k, v] of Object.entries(node)) out[k] = resolve(v, seen, depth + 1);
    return out;
  };
  return resolve;
}

export function normaliseSpec(doc: any): ParsedSpec {
  if (!doc || typeof doc !== "object") throw badRequest("Specification must be an object");
  const isV3 = typeof doc.openapi === "string" && doc.openapi.startsWith("3");
  const isV2 = doc.swagger === "2.0";
  if (!isV3 && !isV2) throw badRequest('Not an OpenAPI 3.x or Swagger 2.0 document (missing "openapi" or "swagger" field)');
  if (!doc.paths || typeof doc.paths !== "object") throw badRequest('Specification has no "paths"');

  const resolve = makeResolver(doc);
  let baseUrl: string | undefined;
  if (isV3 && Array.isArray(doc.servers) && doc.servers[0]?.url) {
    baseUrl = String(doc.servers[0].url);
    for (const [name, v] of Object.entries<any>(doc.servers[0].variables ?? {})) baseUrl = baseUrl.replace(`{${name}}`, String(v?.default ?? ""));
  } else if (isV2 && doc.host) {
    baseUrl = `${(doc.schemes?.[0] as string) ?? "https"}://${doc.host}${doc.basePath ?? ""}`;
  }
  if (baseUrl) baseUrl = baseUrl.replace(/\/$/, "");

  const globalSecured = Array.isArray(doc.security) && doc.security.length > 0;
  const endpoints: EndpointDescriptor[] = [];

  for (const [path, rawItem] of Object.entries<any>(doc.paths)) {
    const item = resolve(rawItem);
    const sharedParams: any[] = item.parameters ?? [];
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      const allParams = [...sharedParams, ...(op.parameters ?? [])];
      const parameters: EndpointParam[] = [];
      let requestBody: EndpointDescriptor["requestBody"];
      const formProps: Record<string, any> = {};
      const formRequired: string[] = [];

      for (const p of allParams) {
        if (!p?.name) continue;
        if (isV2 && p.in === "body") {
          requestBody = { required: !!p.required, contentType: "application/json", schema: p.schema };
          continue;
        }
        if (isV2 && p.in === "formData") {
          formProps[p.name] = { type: p.type, format: p.format };
          if (p.required) formRequired.push(p.name);
          continue;
        }
        if (!["path", "query", "header", "cookie"].includes(p.in)) continue;
        const schema = isV3 ? p.schema : { type: p.type, format: p.format, enum: p.enum, minimum: p.minimum, maximum: p.maximum, maxLength: p.maxLength, default: p.default };
        parameters.push({ name: p.name, in: p.in, required: p.in === "path" ? true : !!p.required, schema, description: p.description });
      }
      if (Object.keys(formProps).length) requestBody = { required: formRequired.length > 0, contentType: "application/x-www-form-urlencoded", schema: { type: "object", properties: formProps, required: formRequired } };

      if (isV3 && op.requestBody?.content) {
        const content = op.requestBody.content;
        const ct = Object.keys(content).find((c) => c.includes("json")) ?? Object.keys(content)[0];
        if (ct) requestBody = { required: !!op.requestBody.required, contentType: ct, schema: content[ct]?.schema };
      }

      const responses: EndpointDescriptor["responses"] = {};
      for (const [code, r] of Object.entries<any>(op.responses ?? {})) {
        let schema: JsonSchema | undefined;
        if (isV3 && r?.content) {
          const ct = Object.keys(r.content).find((c) => c.includes("json")) ?? Object.keys(r.content)[0];
          schema = ct ? r.content[ct]?.schema : undefined;
        } else if (isV2) schema = r?.schema;
        responses[code] = { description: r?.description, schema };
      }

      const method = m.toUpperCase() as HttpMethodName;
      endpoints.push({
        id: `${method} ${path}`,
        method,
        path,
        summary: op.summary,
        description: typeof op.description === "string" ? op.description.slice(0, 1000) : undefined,
        operationId: op.operationId,
        tags: Array.isArray(op.tags) ? op.tags : [],
        parameters,
        requestBody,
        responses,
        secured: Array.isArray(op.security) ? op.security.length > 0 : globalSecured,
      });
    }
  }

  const schemes = isV3 ? doc.components?.securitySchemes : doc.securityDefinitions;
  return {
    title: String(doc.info?.title ?? "Imported API").slice(0, 120),
    version: doc.info?.version ? String(doc.info.version) : undefined,
    specVersion: isV3 ? doc.openapi : "2.0",
    baseUrl,
    endpoints,
    securitySchemes: resolve(schemes ?? {}),
  };
}

/** Builds a realistic example value from a JSON schema. */
export function exampleFromSchema(schema: JsonSchema | undefined, propName = "", depth = 0): unknown {
  if (!schema || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: JsonSchema) => exampleFromSchema(s, propName, depth + 1) ?? {}));
  if (schema.oneOf?.[0] || schema.anyOf?.[0]) return exampleFromSchema(schema.oneOf?.[0] ?? schema.anyOf?.[0], propName, depth + 1);
  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== "null") : schema.type ?? (schema.properties ? "object" : undefined);
  const name = propName.toLowerCase();
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries<JsonSchema>(schema.properties ?? {})) {
        if (v?.readOnly) continue;
        out[k] = exampleFromSchema(v, k, depth + 1);
      }
      return out;
    }
    case "array":
      return [exampleFromSchema(schema.items, propName, depth + 1)];
    case "integer":
    case "number": {
      const min = typeof schema.minimum === "number" ? schema.minimum : undefined;
      if (name.includes("age")) return Math.max(min ?? 0, 30);
      if (name.includes("price") || name.includes("amount")) return 19.99;
      return min !== undefined ? min + (type === "integer" ? 1 : 0.5) : 1;
    }
    case "boolean":
      return true;
    case "string": {
      switch (schema.format) {
        case "email":
          return "jane.doe@example.com";
        case "uuid":
          return "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        case "date-time":
          return "2026-01-15T09:30:00Z";
        case "date":
          return "2026-01-15";
        case "uri":
        case "url":
          return "https://example.com";
        case "password":
          return "S3cure-Passw0rd!";
      }
      if (name.includes("email")) return "jane.doe@example.com";
      if (name.includes("name")) return name.includes("user") ? "janedoe" : "Jane Doe";
      if (name.includes("phone")) return "+1-555-0100";
      if (name.includes("title")) return "Sample title";
      const s = "sample";
      return typeof schema.minLength === "number" && schema.minLength > s.length ? s.padEnd(schema.minLength, "x") : s;
    }
    default:
      return null;
  }
}

/** Replaces {param} with example values (or 1) so the request is immediately sendable. */
export function fillPath(ep: EndpointDescriptor): string {
  return ep.path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const p = ep.parameters.find((x) => x.in === "path" && x.name === name);
    const v = exampleFromSchema(p?.schema, name);
    return encodeURIComponent(String(v ?? 1));
  });
}

export function successStatus(ep: EndpointDescriptor): number {
  const codes = Object.keys(ep.responses).filter((c) => /^2\d\d$/.test(c)).map(Number).sort();
  if (codes.length) return codes[0]!;
  return ep.method === "POST" ? 201 : ep.method === "DELETE" ? 204 : 200;
}
