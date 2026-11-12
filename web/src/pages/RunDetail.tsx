import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Download, GitCompare, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, http } from "../lib/api";
import { formatMs, timeAgo } from "../lib/format";
import type { ChangeKind, CompareResponse, RunDetail as Run, TestResult } from "../lib/types";
import { CodeView } from "../components/CodeView";
import { Markdown } from "../components/Markdown";
import { describeAssertion } from "../components/AssertionEditor";
import { Badge, Button, EmptyState, ErrorState, LoadingBlock, MethodBadge, Spinner, StatusBadge, Tabs, cx, type Tone } from "../components/ui";

const changeMeta: Record<ChangeKind, { label: string; tone: Tone }> = {
  newFailure: { label: "New failure", tone: "bad" },
  stillFailing: { label: "Still failing", tone: "warn" },
  fixed: { label: "Fixed", tone: "ok" },
  added: { label: "New test", tone: "info" },
  removed: { label: "Removed", tone: "muted" },
  stillPassing: { label: "Passing", tone: "muted" },
};

export default function RunDetail() {
  const { runId } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"results" | "compare">("results");
  const [filter, setFilter] = useState<"all" | "failed">("all");
  const q = useQuery({
    queryKey: ["run", runId],
    queryFn: () => http.get<Run>(`/runs/${runId}`),
    refetchInterval: (query) => (query.state.data && ["QUEUED", "RUNNING"].includes(query.state.data.status) ? 1000 : false),
  });
  const cmp = useQuery({ queryKey: ["compare", runId], queryFn: () => http.get<CompareResponse>(`/runs/${runId}/compare`), enabled: q.data?.status === "COMPLETED" });
  const resummarize = useMutation({ mutationFn: () => http.post(`/runs/${runId}/summarize`), onSuccess: () => qc.invalidateQueries({ queryKey: ["run", runId] }) });

  const download = async (format: "markdown" | "json") => {
    const text = format === "json" ? JSON.stringify(await http.get(`/runs/${runId}/report?format=json`), null, 2) : await api<string>(`/runs/${runId}/report`, { raw: true });
    const url = URL.createObjectURL(new Blob([text], { type: format === "json" ? "application/json" : "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `apiforge-report-${runId}.${format === "json" ? "json" : "md"}` });
    a.click();
    URL.revokeObjectURL(url);
  };

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const run = q.data;
  const running = run.status === "QUEUED" || run.status === "RUNNING";
  const rate = run.total ? run.passed / run.total : 0;
  const results = filter === "failed" ? run.results.filter((r) => !r.passed) : run.results;
  const newFailures = cmp.data?.comparison?.counts.newFailure ?? 0;

  return (
    <div className="animate-fade-in">
      <Link to={`/tests/${run.suite.id}`} className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft className="size-3" /> {run.suite.name}</Link>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Test run report</h1>
          <p className="mt-1 text-sm text-muted">{new Date(run.createdAt).toLocaleString()} · {timeAgo(run.createdAt)}</p>
        </div>
        {run.status === "COMPLETED" && (
          <>
            <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => void download("markdown")}>Markdown</Button>
            <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => void download("json")}>JSON</Button>
          </>
        )}
      </div>

      {running ? (
        <div className="card flex items-center gap-3 p-6 text-sm text-muted"><Spinner /> Running {run.total} tests… results appear when the run completes.</div>
      ) : run.status === "FAILED" ? (
        <div className="card"><ErrorState error={new Error(run.error ?? "The run failed")} /></div>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-4">
            <div className="card p-4">
              <div className="text-xs text-muted">Pass rate</div>
              <div className={cx("mt-1 text-2xl font-semibold tabular-nums", rate === 1 ? "text-ok" : rate >= 0.7 ? "text-warn" : "text-bad")}>{Math.round(rate * 100)}%</div>
              <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full"><div className="bg-ok" style={{ width: `${rate * 100}%` }} />{rate < 1 && <div className="flex-1 bg-bad" />}</div>
            </div>
            <div className="card p-4"><div className="text-xs text-muted">Passed</div><div className="mt-1 text-2xl font-semibold tabular-nums">{run.passed}</div></div>
            <div className="card p-4"><div className="text-xs text-muted">Failed</div><div className="mt-1 text-2xl font-semibold tabular-nums">{run.failed}</div></div>
            <div className="card p-4"><div className="text-xs text-muted">Duration</div><div className="mt-1 text-2xl font-semibold tabular-nums">{formatMs(run.durationMs)}</div></div>
          </div>

          {newFailures > 0 && (
            <button onClick={() => setTab("compare")} className="mb-4 flex w-full items-center gap-2 rounded-lg border border-bad/40 bg-bad/10 px-4 py-2.5 text-left text-sm text-bad">
              <GitCompare className="size-4" /> {newFailures} newly introduced failure{newFailures > 1 ? "s" : ""} since the previous run — view regression comparison
            </button>
          )}

          {run.summary && (
            <section className="card mb-4 p-4">
              <div className="mb-1 flex items-center gap-2">
                <Sparkles className="size-4 text-accent" />
                <h2 className="text-sm font-semibold">Failure summary</h2>
                <Badge tone="muted">{run.summarySource === "claude" ? "Claude" : "built-in"}</Badge>
                <Button size="sm" variant="ghost" className="ml-auto" icon={<RefreshCw className="size-3" />} loading={resummarize.isPending} onClick={() => resummarize.mutate()}>Regenerate</Button>
              </div>
              <Markdown text={run.summary} />
            </section>
          )}

          <Tabs className="mb-3" value={tab} onChange={setTab} tabs={[{ id: "results", label: "Results", count: run.results.length }, { id: "compare", label: "Regression comparison", count: newFailures || undefined }]} />
          {tab === "results" ? (
            <>
              <div className="mb-2 flex gap-1">
                <Button size="sm" variant={filter === "all" ? "secondary" : "ghost"} onClick={() => setFilter("all")}>All</Button>
                <Button size="sm" variant={filter === "failed" ? "secondary" : "ghost"} onClick={() => setFilter("failed")}>Failed only ({run.failed})</Button>
              </div>
              <div className="card overflow-hidden">
                {results.length === 0 ? <EmptyState icon={<CheckCircle2 className="size-5" />} title="No failures" description="Every test in this run passed." /> : results.map((r) => <ResultRow key={r.id} r={r} />)}
              </div>
            </>
          ) : (
            <ComparePanel data={cmp.data} loading={cmp.isLoading} error={cmp.error} />
          )}
        </>
      )}
    </div>
  );
}

function ResultRow({ r }: { r: TestResult }) {
  const [open, setOpen] = useState(!r.passed);
  return (
    <div className="border-b border-line last:border-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2/40">
        {open ? <ChevronDown className="size-3.5 text-faint" /> : <ChevronRight className="size-3.5 text-faint" />}
        {r.passed ? <CheckCircle2 className="size-4 shrink-0 text-ok" /> : <XCircle className="size-4 shrink-0 text-bad" />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.name}</span>
        <MethodBadge method={r.method} />
        <StatusBadge status={r.status} error={r.error} />
        <span className="w-16 text-right text-xs tabular-nums text-faint">{formatMs(r.durationMs)}</span>
      </button>
      {open && (
        <div className="space-y-3 bg-surface-2/30 px-11 pb-4 pt-1">
          <div className="truncate font-mono text-xs text-faint">{r.method} {r.url}</div>
          {r.error && <p className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{r.error}</p>}
          <ul className="space-y-1">
            {r.assertions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                {a.passed ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-bad" />}
                <span className="font-mono">{describeAssertion(a.assertion)}</span>
                {!a.passed && <span className="text-muted">— actual: <span className="font-mono text-fg">{JSON.stringify(a.actual) ?? "nothing"}</span></span>}
              </li>
            ))}
          </ul>
          {r.responseBody && <CodeView text={r.responseBody} maxHeight="220px" />}
        </div>
      )}
    </div>
  );
}

function ComparePanel({ data, loading, error }: { data?: CompareResponse; loading: boolean; error: unknown }) {
  if (loading) return <LoadingBlock />;
  if (error) return <div className="card"><ErrorState error={error} /></div>;
  if (!data?.comparison || !data.base) return <div className="card"><EmptyState icon={<GitCompare className="size-5" />} title="Nothing to compare yet" description="This is the first completed run of the suite. Run it again to see what changed." /></div>;
  const c = data.comparison;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs text-muted">
        Compared with run from {new Date(data.base.createdAt).toLocaleString()} ({data.base.passed}/{data.base.total} passed)
        {c.avgDurationDeltaMs != null && <span>· avg duration {c.avgDurationDeltaMs >= 0 ? "+" : ""}{c.avgDurationDeltaMs} ms</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(changeMeta) as ChangeKind[]).filter((k) => c.counts[k]).map((k) => <Badge key={k} tone={changeMeta[k].tone}>{changeMeta[k].label}: {c.counts[k]}</Badge>)}
      </div>
      <div className="card overflow-hidden">
        {c.entries.map((e) => (
          <div key={e.key} className={cx("flex items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-0", e.change === "newFailure" && "bg-bad/5")}>
            <Badge tone={changeMeta[e.change].tone} className="w-24 justify-center">{changeMeta[e.change].label}</Badge>
            <span className="min-w-0 flex-1 truncate">{e.name}</span>
            <span className="text-xs text-faint">{e.base?.status ?? "—"} → {e.current?.status ?? "—"}</span>
            <span className={cx("w-20 text-right text-xs tabular-nums", (e.durationDeltaMs ?? 0) > 200 ? "text-warn" : "text-faint")}>{e.durationDeltaMs == null ? "" : `${e.durationDeltaMs >= 0 ? "+" : ""}${e.durationDeltaMs} ms`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
