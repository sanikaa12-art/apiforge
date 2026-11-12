import { z } from "zod";

/**
 * Assertions are stored as JSON on each test case. One flat shape keeps them easy
 * to edit in the UI and easy for the AI generator to produce:
 *   status       → operator over the HTTP status code
 *   header       → `path` is the header name
 *   jsonPath     → `path` is a dot/bracket path into the JSON body, e.g. data.items[0].id
 *   bodyContains → raw body text contains `expected`
 *   responseTime → milliseconds
 */
export const assertionTypes = ["status", "header", "jsonPath", "bodyContains", "responseTime"] as const;
export const assertionOperators = [
  "equals",
  "notEquals",
  "lessThan",
  "greaterThan",
  "in",
  "exists",
  "notExists",
  "contains",
  "notContains",
  "type",
  "lengthGreaterThan",
  "matches",
] as const;

export const assertionSchema = z.object({
  type: z.enum(assertionTypes),
  operator: z.enum(assertionOperators),
  path: z.string().max(500).nullish(),
  expected: z.union([z.string().max(10_000), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()])).max(50)]).optional(),
});
export type Assertion = z.infer<typeof assertionSchema>;

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actual: unknown;
  message: string;
}

export interface ResponseLike {
  status: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

export function getPath(data: unknown, path: string): { found: boolean; value: unknown } {
  const clean = path.trim().replace(/^\$\.?/, "");
  if (clean === "") return { found: data !== undefined, value: data };
  const tokens = clean.match(/[^.[\]]+|\[(\d+)\]/g) ?? [];
  let cur: unknown = data;
  for (const raw of tokens) {
    const token = raw.startsWith("[") ? raw.slice(1, -1) : raw;
    if (cur === null || typeof cur !== "object") return { found: false, value: undefined };
    if (Array.isArray(cur)) {
      if (token === "length") {
        cur = cur.length;
        continue;
      }
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx >= cur.length) return { found: false, value: undefined };
      cur = cur[idx < 0 ? cur.length + idx : idx];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, token)) return { found: false, value: undefined };
      cur = (cur as Record<string, unknown>)[token];
    }
  }
  return { found: true, value: cur };
}

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

function toList(expected: Assertion["expected"]): (string | number)[] {
  if (Array.isArray(expected)) return expected;
  if (typeof expected === "string") return expected.split(",").map((s) => s.trim()).filter(Boolean);
  if (typeof expected === "number") return [expected];
  return [];
}

function looseEquals(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "object" && actual !== null) return JSON.stringify(actual) === (typeof expected === "string" ? expected : JSON.stringify(expected));
  // "200" equals 200, "true" equals true — the editor stores user input as text.
  return String(actual) === String(expected);
}

function compare(op: Assertion["operator"], actual: unknown, found: boolean, expected: Assertion["expected"]): boolean {
  switch (op) {
    case "exists":
      return found && actual !== undefined;
    case "notExists":
      return !found || actual === undefined;
    case "equals":
      return found && looseEquals(actual, expected);
    case "notEquals":
      return !found || !looseEquals(actual, expected);
    case "lessThan":
      return found && Number(actual) < Number(expected);
    case "greaterThan":
      return found && Number(actual) > Number(expected);
    case "in":
      return found && toList(expected).some((e) => looseEquals(actual, e));
    case "contains":
      if (!found) return false;
      if (Array.isArray(actual)) return actual.some((a) => looseEquals(a, expected));
      return String(typeof actual === "object" ? JSON.stringify(actual) : actual).includes(String(expected));
    case "notContains":
      return !compare("contains", actual, found, expected);
    case "type":
      return found && typeOf(actual) === String(expected);
    case "lengthGreaterThan": {
      const len = Array.isArray(actual) || typeof actual === "string" ? actual.length : actual && typeof actual === "object" ? Object.keys(actual).length : -1;
      return found && len > Number(expected);
    }
    case "matches":
      try {
        const pattern = String(expected);
        if (pattern.length > 500) return false;
        return found && new RegExp(pattern).test(String(actual));
      } catch {
        return false;
      }
  }
}

export function describeAssertion(a: Assertion): string {
  const exp = a.expected === undefined ? "" : ` ${Array.isArray(a.expected) ? a.expected.join(" | ") : JSON.stringify(a.expected)}`;
  const subject = a.type === "status" ? "status" : a.type === "header" ? `header "${a.path}"` : a.type === "jsonPath" ? `body.${a.path ?? ""}` : a.type === "responseTime" ? "response time (ms)" : "body";
  return `${subject} ${a.operator}${exp}`;
}

export function evaluateAssertion(a: Assertion, res: ResponseLike, parsedBody?: { ok: boolean; value: unknown }): AssertionResult {
  let actual: unknown;
  let found = true;
  switch (a.type) {
    case "status":
      actual = res.status;
      break;
    case "responseTime":
      actual = res.durationMs;
      break;
    case "bodyContains":
      actual = res.body;
      if (a.operator === "equals" || a.operator === "contains" || a.operator === "notContains" || a.operator === "matches") break;
      break;
    case "header": {
      const name = (a.path ?? "").toLowerCase();
      found = name in res.headers;
      actual = res.headers[name];
      break;
    }
    case "jsonPath": {
      const parsed = parsedBody ?? safeJson(res.body);
      if (!parsed.ok) {
        return { assertion: a, passed: a.operator === "notExists", actual: undefined, message: `${describeAssertion(a)} — response body is not JSON` };
      }
      const r = getPath(parsed.value, a.path ?? "");
      found = r.found;
      actual = r.value;
      break;
    }
  }
  const op = a.type === "bodyContains" && a.operator === "equals" ? "contains" : a.operator;
  const passed = compare(op, actual, found, a.expected);
  const shown = typeof actual === "string" && actual.length > 200 ? `${actual.slice(0, 200)}…` : actual;
  return {
    assertion: a,
    passed,
    actual: shown,
    message: passed ? `✓ ${describeAssertion(a)}` : `✗ Expected ${describeAssertion(a)}, got ${found ? JSON.stringify(shown) : "nothing (not found)"}`,
  };
}

export function safeJson(text: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: undefined };
  }
}

export function evaluateAll(assertions: Assertion[], res: ResponseLike): AssertionResult[] {
  const parsed = safeJson(res.body);
  return assertions.map((a) => evaluateAssertion(a, res, parsed));
}

export function parseAssertions(json: unknown): Assertion[] {
  const r = z.array(assertionSchema).safeParse(json);
  return r.success ? r.data : [];
}
