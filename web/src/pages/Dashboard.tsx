import { useQuery } from "@tanstack/react-query";
import { Activity, AlertOctagon, ArrowRight, CheckCircle2, FlaskConical, Send, Timer, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { http } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatMs, formatPercent, timeAgo } from "../lib/format";
import type { DashboardData } from "../lib/types";
import { LatencyChart, RequestsChart } from "../components/Charts";
import { Button, EmptyState, ErrorState, MethodBadge, PageHeader, Select, Skeleton, StatusBadge, cx } from "../components/ui";

function Stat({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon: React.ReactNode; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        {label}
        <span className="text-faint">{icon}</span>
      </div>
      <div className={cx("mt-2 text-2xl font-semibold tracking-tight tabular-nums", tone === "ok" && "text-ok", tone === "bad" && "text-bad", tone === "warn" && "text-warn")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ["dashboard", days], queryFn: () => http.get<DashboardData>(`/dashboard?days=${days}`) });
  const d = q.data;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Welcome back, ${user?.name.split(" ")[0] ?? ""}`}
        description="How your APIs and test suites are doing."
        actions={
          <Select aria-label="Time range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-8 w-36 py-0 text-[13px]">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
        }
      />
      {q.isError ? (
        <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
      ) : !d ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}<Skeleton className="h-72 sm:col-span-2 lg:col-span-4" /></div>
      ) : d.totals.totalRequests === 0 && d.totals.testRuns === 0 ? (
        <div className="card">
          <EmptyState icon={<Activity className="size-5" />} title="No activity yet" description="Send your first request or import an OpenAPI spec to start seeing metrics here." action={<div className="flex gap-2"><Link to="/workspace"><Button variant="primary">Open API client</Button></Link><Link to="/openapi"><Button>Import OpenAPI</Button></Link></div>} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total requests" value={d.totals.totalRequests.toLocaleString()} sub={`${d.totals.requestsInPeriod.toLocaleString()} in the last ${days} days`} icon={<Send className="size-4" />} />
            <Stat label="Test success rate" value={formatPercent(d.totals.testSuccessRate)} sub={`${d.totals.testRuns} run${d.totals.testRuns === 1 ? "" : "s"} in period`} icon={<FlaskConical className="size-4" />} tone={d.totals.testSuccessRate == null ? undefined : d.totals.testSuccessRate >= 0.9 ? "ok" : d.totals.testSuccessRate >= 0.7 ? "warn" : "bad"} />
            <Stat label="Failed requests" value={d.totals.failedInPeriod.toLocaleString()} sub={`${formatPercent(d.totals.errorRate, 1)} error rate`} icon={<AlertOctagon className="size-4" />} tone={d.totals.errorRate > 0.2 ? "bad" : undefined} />
            <Stat label="Response time" value={formatMs(d.totals.avgResponseMs)} sub={`p50 ${formatMs(d.totals.p50ResponseMs)} · p95 ${formatMs(d.totals.p95ResponseMs)}`} icon={<Timer className="size-4" />} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <div className="card p-4">
              <h2 className="text-sm font-semibold">Requests per day</h2>
              <p className="mb-3 text-xs text-faint">Successful vs. failed</p>
              <RequestsChart data={d.daily} />
            </div>
            <div className="card p-4">
              <h2 className="text-sm font-semibold">Average response time</h2>
              <p className="mb-3 text-xs text-faint">Milliseconds, daily mean</p>
              <LatencyChart data={d.daily} />
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">API performance by endpoint</h2>
              <span className="text-xs text-faint">Top {d.endpoints.length} by volume</span>
            </div>
            {d.endpoints.length === 0 ? (
              <EmptyState title="No requests in this period" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] table-fixed text-[13px]">
                  <thead className="text-left text-[11px] uppercase tracking-wider text-faint">
                    <tr className="border-b border-line">
                      <th className="w-[55%] px-4 py-2 font-medium">Endpoint</th>
                      <th className="px-4 py-2 text-right font-medium">Requests</th>
                      <th className="px-4 py-2 text-right font-medium">Avg</th>
                      <th className="px-4 py-2 text-right font-medium">p95</th>
                      <th className="px-4 py-2 text-right font-medium">Error rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.endpoints.map((e) => {
                      const [method, ...rest] = e.endpoint.split(" ");
                      return (
                        <tr key={e.endpoint} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                          <td className="max-w-0 px-4 py-2">
                            <div className="flex items-center gap-2"><MethodBadge method={method!} className="w-9 shrink-0" /><span className="truncate font-mono text-[12px]">{rest.join(" ")}</span></div>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{e.count}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatMs(e.avgMs)}</td>
                          <td className={cx("px-4 py-2 text-right tabular-nums", (e.p95Ms ?? 0) > 1000 && "text-warn")}>{formatMs(e.p95Ms)}</td>
                          <td className={cx("px-4 py-2 text-right tabular-nums", e.errorRate > 0.1 && "text-bad")}>{formatPercent(e.errorRate, 1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <div className="card">
              <div className="border-b border-line px-4 py-3 text-sm font-semibold">Recent activity</div>
              {d.recentActivity.length === 0 ? <EmptyState title="Nothing yet" /> : (
                <ul>
                  {d.recentActivity.map((a, i) => {
                    const inner = (
                      <>
                        {a.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px]">{a.title}</div>
                          <div className="text-xs text-faint">{a.type === "testRun" ? "Test run" : "Request"}{a.detail ? ` · ${a.detail}` : ""}</div>
                        </div>
                        <span className="shrink-0 text-xs text-faint">{timeAgo(a.at)}</span>
                      </>
                    );
                    return (
                      <li key={i} className="border-b border-line last:border-0">
                        {a.type === "testRun" ? <Link to={`/runs/${a.id}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-2/60">{inner}</Link> : <div className="flex items-start gap-3 px-4 py-2.5">{inner}</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="card">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <span className="text-sm font-semibold">Failed requests</span>
                <Link to="/workspace" className="flex items-center gap-1 text-xs text-muted hover:text-fg">Open client <ArrowRight className="size-3" /></Link>
              </div>
              {d.failedRequests.length === 0 ? <EmptyState icon={<CheckCircle2 className="size-5" />} title="No failures" description="Every recent request succeeded." /> : (
                <ul>
                  {d.failedRequests.map((f) => (
                    <li key={f.id} className="flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-0">
                      <MethodBadge method={f.method} className="mt-0.5 w-9 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[12px]">{f.url}</div>
                        {f.error && <div className="truncate text-xs text-bad">{f.error}</div>}
                      </div>
                      <StatusBadge status={f.status} error={f.error} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
