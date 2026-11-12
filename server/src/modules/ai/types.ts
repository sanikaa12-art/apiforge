import type { Assertion } from "../testing/assertions.js";
import type { HttpMethodName, KeyValue } from "../../lib/types.js";

export type TestCategory = "positive" | "negative" | "edge" | "validation" | "security";

export interface GeneratedTest {
  name: string;
  description: string;
  category: TestCategory;
  method: HttpMethodName;
  url: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  body: string | null;
  assertions: Assertion[];
}

export interface ValidationGap {
  endpoint: string;
  field: string | null;
  issue: string;
  recommendation: string;
  severity: "low" | "medium" | "high";
}

export interface GenerationResult {
  provider: "claude" | "heuristic";
  model?: string;
  tests: GeneratedTest[];
  validationGaps: ValidationGap[];
  notice?: string;
}

export interface GenerationOptions {
  baseUrl: string;
  maxPerEndpoint: number;
  categories: TestCategory[];
}
