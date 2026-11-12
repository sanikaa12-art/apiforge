import type { FailureForSummary } from "./claude.js";

/** Plain-language failure summary without an LLM: classify failures and explain each group. */
export function heuristicSummary(suiteName: string, stats: { total: number; passed: number; failed: number }, failures: FailureForSummary[]): string {
  if (stats.failed === 0) return `All ${stats.total} tests in "${suiteName}" passed. 🎉`;
  const groups: Record<string, { title: string; hint: string; items: string[] }> = {
    network: { title: "Could not reach the API", hint: "Check the base URL / environment, DNS, and whether the service is running. Requests to private networks are blocked by design.", items: [] },
    server: { title: "Server errors (5xx)", hint: "The API crashed or threw an unhandled exception for these inputs. Check server logs; these usually mean missing input validation.", items: [] },
    validation: { title: "Invalid input was accepted", hint: "The API returned success for data that should be rejected. Add server-side validation (required fields, types, lengths, ranges).", items: [] },
    auth: { title: "Authentication / authorization problems", hint: "Got 401/403 unexpectedly — the token may be missing, expired, or the {{authToken}} variable is not set in the selected environment.", items: [] },
    notFound: { title: "Resources not found", hint: "The endpoint or record does not exist — check path parameters and that seed data is present.", items: [] },
    slow: { title: "Slow responses", hint: "Response time exceeded the threshold. Look for N+1 queries or missing indexes.", items: [] },
    other: { title: "Response did not match expectations", hint: "Compare the expected values with the actual response body/headers below.", items: [] },
  };
  for (const f of failures) {
    const label = `**${f.name}** (${f.method} ${f.url}) — ${f.error ?? f.failedAssertions[0] ?? `status ${f.status}`}`;
    const expectedClientError = f.failedAssertions.some((a) => /status in \[?.*4\d\d/.test(a) || /status in "?4\d\d/.test(a));
    if (f.error) groups.network!.items.push(label);
    else if (f.status !== null && f.status >= 500) groups.server!.items.push(label);
    else if (f.status !== null && f.status < 400 && expectedClientError) groups.validation!.items.push(label);
    else if (f.status === 401 || f.status === 403) groups.auth!.items.push(label);
    else if (f.status === 404) groups.notFound!.items.push(label);
    else if (f.failedAssertions.every((a) => a.includes("response time"))) groups.slow!.items.push(label);
    else groups.other!.items.push(label);
  }
  const lines = [`**${stats.failed} of ${stats.total}** tests in "${suiteName}" failed.`, ""];
  for (const g of Object.values(groups)) {
    if (!g.items.length) continue;
    lines.push(`**${g.title}** (${g.items.length})`, `_${g.hint}_`);
    for (const i of g.items.slice(0, 6)) lines.push(`- ${i}`);
    if (g.items.length > 6) lines.push(`- …and ${g.items.length - 6} more`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
