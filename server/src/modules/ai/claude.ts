/**
 * Claude-backed generation. Only used when ANTHROPIC_API_KEY is configured.
 * What is sent: endpoint shapes (method, path, parameter/body schemas) and, for
 * summaries, failed assertion messages. Environment variables are never resolved
 * before this point and stored results are already secret-redacted, so no
 * secret values leave the server.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { httpMethods } from "../../lib/types.js";
import { assertionOperators, assertionSchema, assertionTypes } from "../testing/assertions.js";
import type { EndpointDescriptor } from "../openapi/parser.js";
import type { GeneratedTest, GenerationOptions, ValidationGap } from "./types.js";

let client: Anthropic | undefined;
export const claudeEnabled = () => !!env.ANTHROPIC_API_KEY;
const getClient = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 180_000, maxRetries: 2 }));

const kv = z.object({ key: z.string(), value: z.string() });
const OutputSchema = z.object({
  tests: z.array(
    z.object({
      endpoint: z.string(),
      name: z.string(),
      description: z.string(),
      category: z.enum(["positive", "negative", "edge", "validation", "security"]),
      method: z.enum(httpMethods),
      path: z.string(),
      queryParams: z.array(kv),
      headers: z.array(kv),
      body: z.string().nullable(),
      assertions: z.array(
        z.object({
          type: z.enum(assertionTypes),
          operator: z.enum(assertionOperators),
          path: z.string().nullable(),
          expected: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        }),
      ),
    }),
  ),
  validationGaps: z.array(
    z.object({
      endpoint: z.string(),
      field: z.string().nullable(),
      issue: z.string(),
      recommendation: z.string(),
      severity: z.enum(["low", "medium", "high"]),
    }),
  ),
});

const GENERATION_SYSTEM = `You are a senior API test engineer. You design focused, high-signal HTTP test cases from endpoint definitions.

Rules for the tests you write:
- "path" is relative to the base URL and starts with "/". Replace path parameters with concrete realistic values. Use 999999999 or "does-not-exist" style ids for not-found cases.
- Use the placeholder {{authToken}} for credentials, e.g. header Authorization: Bearer {{authToken}}. Never invent real secrets.
- "body" is a JSON string (or null). Keep bodies small and realistic.
- Assertion types: status, header (path = header name), jsonPath (path like "data.items[0].id" or "$" for the root), bodyContains, responseTime (ms).
  Operators: equals, notEquals, lessThan, greaterThan, in (expected = comma-separated list, e.g. "400,422"), exists, notExists, contains, notContains, type (expected = string|number|boolean|object|array|null), lengthGreaterThan, matches (regex).
  Use path = null when the assertion type does not need it.
- Prefer status "in" lists for error cases where several codes are acceptable (400/422).
- Cover: happy path; missing/invalid required fields; wrong types; boundary values; oversized input; auth failures for secured endpoints; not-found; robustness (server must not return 5xx).
- In validationGaps, report schema weaknesses a tester would flag: unbounded strings, missing numeric ranges, no required list, undocumented error responses, unauthenticated writes, accepting unknown properties.`;

export async function claudeGenerate(endpoints: EndpointDescriptor[], opts: GenerationOptions): Promise<{ tests: GeneratedTest[]; gaps: ValidationGap[] }> {
  const compact = endpoints.map((e) => ({
    endpoint: e.id,
    summary: e.summary,
    description: e.description,
    parameters: e.parameters,
    requestBody: e.requestBody,
    responses: e.responses,
    secured: e.secured,
  }));
  const prompt = `Generate up to ${opts.maxPerEndpoint} tests per endpoint. Only use these categories: ${opts.categories.join(", ")}.

Endpoints (JSON):
${JSON.stringify(compact, null, 1).slice(0, 150_000)}`;

  const response = await getClient().beta.messages.parse({
    model: env.AI_MODEL,
    max_tokens: 32_000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(OutputSchema) },
    system: GENERATION_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI model declined this request");
  if (response.stop_reason === "max_tokens") logger.warn("AI test generation hit max_tokens; output may be partial");
  const out = response.parsed_output;
  if (!out) throw new Error("The AI response could not be parsed");

  const tests: GeneratedTest[] = [];
  for (const t of out.tests) {
    const assertions = t.assertions
      .map((a) => assertionSchema.safeParse({ ...a, path: a.path ?? undefined }))
      .filter((r) => r.success)
      .map((r) => r.data!);
    if (!assertions.length) continue;
    tests.push({
      name: t.name.slice(0, 200),
      description: t.description.slice(0, 2000),
      category: t.category,
      method: t.method,
      url: `${opts.baseUrl}${t.path.startsWith("/") ? t.path : `/${t.path}`}`,
      headers: t.headers.map((h) => ({ ...h, enabled: true })),
      queryParams: t.queryParams.map((q) => ({ ...q, enabled: true })),
      body: t.body,
      assertions,
    });
  }
  return { tests, gaps: out.validationGaps };
}

export interface FailureForSummary {
  name: string;
  method: string;
  url: string;
  status: number | null;
  error: string | null;
  failedAssertions: string[];
  bodySnippet: string | null;
}

export async function claudeSummarize(suiteName: string, stats: { total: number; passed: number; failed: number }, failures: FailureForSummary[]): Promise<string> {
  const response = await getClient().beta.messages.create({
    model: env.AI_MODEL,
    max_tokens: 16_000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system:
      "You explain API test failures to developers in plain, friendly language. Group related failures, name the most likely root cause for each group, and suggest a concrete next step. Use short Markdown: a one-sentence overview, then a bulleted list per group. Do not repeat every assertion verbatim. Keep it under 250 words.",
    messages: [
      {
        role: "user",
        content: `Suite "${suiteName}": ${stats.passed}/${stats.total} passed, ${stats.failed} failed.\n\nFailures (JSON):\n${JSON.stringify(failures.slice(0, 40), null, 1)}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI model declined this request");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
  if (!text) throw new Error("Empty AI summary");
  return text;
}
