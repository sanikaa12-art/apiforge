export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
export const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
}
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  collectionId: string;
}
export interface RequestSummary {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  folderId: string | null;
}
export interface SavedRequest extends RequestSummary {
  collectionId: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  body: string | null;
  bodyType: "none" | "json" | "text" | "form";
  description: string | null;
}
export interface Collection {
  id: string;
  name: string;
  description: string | null;
  folders: Folder[];
  requests: RequestSummary[];
}
export type EnvironmentKind = "DEVELOPMENT" | "STAGING" | "PRODUCTION" | "CUSTOM";
export interface EnvVariable {
  id?: string;
  key: string;
  value: string;
  isSecret: boolean;
  hasValue?: boolean;
}
export interface Environment {
  id: string;
  name: string;
  kind: EnvironmentKind;
  variables: EnvVariable[];
}
export interface ExecuteResponse {
  historyId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  sizeBytes: number;
  durationMs: number;
  truncated: boolean;
  redirects: string[];
  unresolvedVariables: string[];
}
export interface HistoryItem {
  id: string;
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  sizeBytes: number | null;
  error: string | null;
  createdAt: string;
}
export type AssertionType = "status" | "header" | "jsonPath" | "bodyContains" | "responseTime";
export type AssertionOperator = "equals" | "notEquals" | "lessThan" | "greaterThan" | "in" | "exists" | "notExists" | "contains" | "notContains" | "type" | "lengthGreaterThan" | "matches";
export interface Assertion {
  type: AssertionType;
  operator: AssertionOperator;
  path?: string | null;
  expected?: string | number | boolean | null | (string | number)[];
}
export type TestCategory = "positive" | "negative" | "edge" | "validation" | "security";
export interface TestCase {
  id: string;
  suiteId: string;
  name: string;
  description: string | null;
  category: TestCategory;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  body: string | null;
  assertions: Assertion[];
  status: "DRAFT" | "APPROVED" | "REJECTED";
  source: "MANUAL" | "AI" | "HEURISTIC" | "OPENAPI";
}
export type RunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
export interface TestRun {
  id: string;
  suiteId: string;
  status: RunStatus;
  total: number;
  passed: number;
  failed: number;
  durationMs: number | null;
  summary: string | null;
  summarySource: string | null;
  error: string | null;
  createdAt: string;
}
export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actual: unknown;
  message: string;
}
export interface TestResult {
  id: string;
  testCaseId: string | null;
  name: string;
  method: string;
  url: string;
  passed: boolean;
  status: number | null;
  durationMs: number | null;
  error: string | null;
  assertions: AssertionResult[];
  responseBody: string | null;
}
export interface TestSuite {
  id: string;
  name: string;
  description: string | null;
  environmentId: string | null;
  environment?: { id: string; name: string } | null;
}
export interface SuiteListItem extends TestSuite {
  _count: { cases: number };
  draftCount: number;
  lastRun: Pick<TestRun, "id" | "status" | "passed" | "failed" | "total" | "createdAt"> | null;
}
export interface SuiteDetail extends TestSuite {
  cases: TestCase[];
  runs: TestRun[];
}
export interface RunDetail extends TestRun {
  suite: { id: string; name: string };
  results: TestResult[];
}
export interface ValidationGap {
  endpoint: string;
  field: string | null;
  issue: string;
  recommendation: string;
  severity: "low" | "medium" | "high";
}
export type ChangeKind = "newFailure" | "fixed" | "stillFailing" | "stillPassing" | "added" | "removed";
export interface CompareResponse {
  base: { id: string; createdAt: string; passed: number; failed: number; total: number } | null;
  current: { id: string; createdAt: string };
  comparison: {
    entries: { key: string; name: string; change: ChangeKind; base?: { status: number | null; durationMs: number | null }; current?: { status: number | null; durationMs: number | null }; durationDeltaMs: number | null }[];
    counts: Record<ChangeKind, number>;
    hasRegressions: boolean;
    avgDurationDeltaMs: number | null;
  } | null;
}
export interface EndpointDescriptor {
  id: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  tags: string[];
  secured: boolean;
}
export interface ParsedSpec {
  title: string;
  version?: string;
  specVersion: string;
  baseUrl?: string;
  endpoints: EndpointDescriptor[];
}
export interface ApiSpecItem {
  id: string;
  title: string;
  version: string | null;
  baseUrl: string | null;
  collectionId: string | null;
  createdAt: string;
  endpointCount: number;
  endpoints: EndpointDescriptor[];
}
export interface DashboardData {
  periodDays: number;
  totals: {
    totalRequests: number;
    requestsInPeriod: number;
    failedInPeriod: number;
    errorRate: number;
    avgResponseMs: number | null;
    p50ResponseMs: number | null;
    p95ResponseMs: number | null;
    testRuns: number;
    testSuccessRate: number | null;
    collections: number;
    suites: number;
    environments: number;
  };
  daily: { date: string; requests: number; failed: number; avgMs: number | null; testSuccessRate: number | null }[];
  endpoints: { endpoint: string; count: number; errorRate: number; avgMs: number | null; p95Ms: number | null }[];
  recentActivity: { type: "request" | "testRun"; id?: string; suiteId?: string; title: string; status: number | null; ok: boolean; at: string; detail: string | null }[];
  failedRequests: HistoryItem[];
}
