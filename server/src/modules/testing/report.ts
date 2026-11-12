import { describeAssertion, type AssertionResult } from "./assertions.js";

interface RunForReport {
  id: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number | null;
  createdAt: Date;
  summary: string | null;
  suite: { name: string };
  results: { name: string; method: string; url: string; passed: boolean; status: number | null; durationMs: number | null; error: string | null; assertions: unknown }[];
}

/** Human-readable Markdown report (renders nicely on GitHub, in PRs, or as plain text). */
export function renderMarkdownReport(run: RunForReport): string {
  const rate = run.total ? Math.round((run.passed / run.total) * 100) : 0;
  const lines = [
    `# Test report — ${run.suite.name}`,
    "",
    `| Run | Date | Result | Pass rate | Duration |`,
    `| --- | --- | --- | --- | --- |`,
    `| \`${run.id}\` | ${run.createdAt.toISOString()} | ${run.passed}/${run.total} passed | ${rate}% | ${run.durationMs ?? "-"} ms |`,
    "",
  ];
  if (run.summary) lines.push("## Summary", "", run.summary, "");
  lines.push("## Results", "");
  for (const r of run.results) {
    lines.push(`### ${r.passed ? "✅" : "❌"} ${r.name}`, "", `\`${r.method} ${r.url}\` → ${r.status ?? "no response"} in ${r.durationMs ?? "-"} ms`, "");
    if (r.error) lines.push(`> ${r.error}`, "");
    for (const a of (Array.isArray(r.assertions) ? r.assertions : []) as AssertionResult[]) {
      lines.push(`- ${a.passed ? "✓" : "✗"} ${describeAssertion(a.assertion)}${a.passed ? "" : ` — actual: \`${JSON.stringify(a.actual)}\``}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
