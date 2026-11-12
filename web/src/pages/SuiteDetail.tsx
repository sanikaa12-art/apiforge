import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCheck, ChevronRight, Pencil, Play, Plus, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { http } from "../lib/api";
import { useEnvironment } from "../lib/environment";
import { formatMs, timeAgo } from "../lib/format";
import { METHODS, type ApiSpecItem, type Collection, type HttpMethod, type KeyValue, type SuiteDetail as Suite, type TestCase, type Assertion, type TestCategory, type ValidationGap } from "../lib/types";
import { AssertionEditor, describeAssertion } from "../components/AssertionEditor";
import { KeyValueEditor } from "../components/KeyValueEditor";
import { Badge, Button, ConfirmButton, EmptyState, ErrorState, Field, IconButton, Input, LoadingBlock, MethodBadge, Modal, Select, Tabs, cx, useToast, type Tone } from "../components/ui";

const catTone: Record<TestCategory, Tone> = { positive: "ok", negative: "warn", edge: "info", validation: "accent", security: "bad" };
const CATEGORIES: TestCategory[] = ["positive", "negative", "edge", "validation", "security"];

export default function SuiteDetail() {
  const { suiteId } = useParams();
  const [search, setSearch] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { environments } = useEnvironment();
  const [genOpen, setGenOpen] = useState(false);
  const [editing, setEditing] = useState<TestCase | "new" | null>(null);
  const [gaps, setGaps] = useState<ValidationGap[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["suite", suiteId],
    queryFn: () => http.get<Suite>(`/suites/${suiteId}`),
    refetchInterval: (query) => (query.state.data?.runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING") ? 1000 : false),
  });
  const suite = q.data;
  const drafts = useMemo(() => suite?.cases.filter((c) => c.status === "DRAFT") ?? [], [suite]);
  const approved = suite?.cases.filter((c) => c.status === "APPROVED") ?? [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["suite", suiteId] });
    void qc.invalidateQueries({ queryKey: ["suites"] });
  };

  useEffect(() => setSelected(new Set(drafts.map((d) => d.id))), [drafts]);
  // Navigate to the report when a run we started finishes
  const [watchRun, setWatchRun] = useState<string | null>(null);
  useEffect(() => {
    const run = suite?.runs.find((r) => r.id === watchRun);
    if (run && (run.status === "COMPLETED" || run.status === "FAILED")) {
      setWatchRun(null);
      navigate(`/runs/${run.id}`);
    }
  }, [suite, watchRun, navigate]);

  const run = useMutation({ mutationFn: () => http.post<{ id: string }>(`/suites/${suiteId}/runs`), onSuccess: (r) => { setWatchRun(r.id); refresh(); }, onError: (e: Error) => toast(e.message, "bad") });
  const review = useMutation({
    mutationFn: (b: { approve: string[]; reject: string[] }) => http.post<{ approved: number; rejected: number }>(`/suites/${suiteId}/cases/review`, b),
    onSuccess: (r) => { toast(`${r.approved} approved, ${r.rejected} discarded`); refresh(); if (search.get("review")) setSearch({}); },
  });
  const patchSuite = useMutation({ mutationFn: (b: object) => http.patch(`/suites/${suiteId}`, b), onSuccess: refresh });
  const delSuite = useMutation({ mutationFn: () => http.del(`/suites/${suiteId}`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["suites"] }); navigate("/tests"); } });
  const delCase = useMutation({ mutationFn: (id: string) => http.del(`/cases/${id}`), onSuccess: refresh });

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !suite) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const activeRun = suite.runs.find((r) => r.status === "QUEUED" || r.status === "RUNNING");

  return (
    <div className="animate-fade-in">
      <Link to="/tests" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft className="size-3" /> Test suites</Link>
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{suite.name}</h1>
          {suite.description && <p className="mt-1 text-sm text-muted">{suite.description}</p>}
        </div>
        <Select aria-label="Suite environment" value={suite.environmentId ?? ""} onChange={(e) => patchSuite.mutate({ environmentId: e.target.value || null })} className="h-9 w-48">
          <option value="">No environment</option>
          {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
        <Button icon={<Sparkles className="size-4 text-accent" />} onClick={() => setGenOpen(true)}>Generate with AI</Button>
        <Button variant="primary" icon={<Play className="size-4" />} loading={run.isPending || !!activeRun} disabled={!approved.length} onClick={() => run.mutate()}>{activeRun ? "Running…" : "Run suite"}</Button>
      </div>

      {drafts.length > 0 && (
        <section className="card mb-6 border-accent/40 shadow-[0_0_0_1px_rgb(124_108_255/0.15),0_8px_30px_-12px_rgb(124_108_255/0.35)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <Sparkles className="size-4 text-accent" />
            <h2 className="text-sm font-semibold">Review generated tests</h2>
            <span className="text-xs text-muted">{drafts.length} drafts · nothing runs until you approve it</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} disabled={!selected.size} onClick={() => review.mutate({ approve: [], reject: [...selected] })}>Discard selected</Button>
              <Button size="sm" variant="primary" icon={<CheckCheck className="size-3.5" />} disabled={!selected.size} loading={review.isPending} onClick={() => review.mutate({ approve: [...selected], reject: [] })}>Approve {selected.size}</Button>
            </div>
          </div>
          {gaps.length > 0 && <GapList gaps={gaps} />}
          <div className="flex items-center gap-2 border-b border-line bg-surface-2/50 px-4 py-1.5 text-xs text-muted">
            <input type="checkbox" aria-label="Select all drafts" checked={selected.size === drafts.length} onChange={(e) => setSelected(e.target.checked ? new Set(drafts.map((d) => d.id)) : new Set())} className="accent-accent" />
            Select all
          </div>
          <ul className="max-h-[480px] overflow-y-auto">
            {drafts.map((c) => (
              <li key={c.id} className="flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-surface-2/40">
                <input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={(e) => { const s = new Set(selected); if (e.target.checked) s.add(c.id); else s.delete(c.id); setSelected(s); }} className="mt-1 accent-accent" />
                <CaseRow c={c} />
                <div className="flex shrink-0 gap-0.5">
                  <IconButton label="Edit" onClick={() => setEditing(c)}><Pencil className="size-3.5" /></IconButton>
                  <IconButton label="Approve" className="hover:text-ok" onClick={() => review.mutate({ approve: [c.id], reject: [] })}><Check className="size-4" /></IconButton>
                  <IconButton label="Discard" className="hover:text-bad" onClick={() => review.mutate({ approve: [], reject: [c.id] })}><X className="size-4" /></IconButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px] [&>*]:min-w-0">
        <section className="card overflow-hidden">
          <div className="flex items-center border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Test cases <span className="font-normal text-faint">· {approved.length}</span></h2>
            <Button size="sm" variant="ghost" className="ml-auto" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Add test</Button>
          </div>
          {approved.length === 0 ? (
            <EmptyState title="No approved tests" description="Add a test manually or generate them with AI, then approve the ones you want." action={<Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={() => setGenOpen(true)}>Generate with AI</Button>} />
          ) : (
            <ul>
              {approved.map((c) => (
                <li key={c.id} className="group flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-surface-2/40">
                  <CaseRow c={c} />
                  <div className="flex shrink-0 opacity-60 group-hover:opacity-100">
                    <IconButton label="Edit test" onClick={() => setEditing(c)}><Pencil className="size-3.5" /></IconButton>
                    <IconButton label="Delete test" onClick={() => delCase.mutate(c.id)}><Trash2 className="size-3.5" /></IconButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          <section className="card">
            <div className="border-b border-line px-4 py-3 text-sm font-semibold">Run history</div>
            {suite.runs.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-faint">Not run yet.</p>
            ) : (
              <ul>
                {suite.runs.map((r) => (
                  <li key={r.id}>
                    <Link to={`/runs/${r.id}`} className="flex items-center gap-2 border-b border-line px-4 py-2 text-[13px] last:border-0 hover:bg-surface-2/50">
                      <span className={cx("size-2 rounded-full", r.status === "COMPLETED" ? (r.failed ? "bg-bad" : "bg-ok") : r.status === "FAILED" ? "bg-bad" : "animate-pulse bg-warn")} />
                      <span className="tabular-nums">{r.status === "COMPLETED" ? `${r.passed}/${r.total}` : r.status.toLowerCase()}</span>
                      <span className="text-xs text-faint">{formatMs(r.durationMs)}</span>
                      <span className="ml-auto text-xs text-faint">{timeAgo(r.createdAt)}</span>
                      <ChevronRight className="size-3.5 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <ConfirmButton variant="ghost" size="sm" className="w-full" icon={<Trash2 className="size-3.5" />} message={`Delete suite "${suite.name}" with all its tests and run history? This cannot be undone.`} onConfirm={() => delSuite.mutate()}>Delete suite</ConfirmButton>
        </aside>
      </div>

      <GenerateModal open={genOpen || search.get("generate") === "1"} onClose={() => { setGenOpen(false); if (search.get("generate")) setSearch({}); }} suiteId={suite.id} onDone={(g) => { setGaps(g); refresh(); }} />
      <CaseEditor suiteId={suite.id} testCase={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  );
}

function CaseRow({ c }: { c: TestCase }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">{c.name}</span>
        <Badge tone={catTone[c.category]}>{c.category}</Badge>
        {c.source !== "MANUAL" && <Badge tone="muted">{c.source === "AI" ? "AI" : c.source === "HEURISTIC" ? "auto" : "spec"}</Badge>}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-xs">
        <MethodBadge method={c.method} />
        <span className="truncate font-mono text-faint">{c.url}</span>
      </div>
      {c.description && <p className="mt-1 text-xs text-muted">{c.description}</p>}
      <div className="mt-1 flex flex-wrap gap-1">
        {c.assertions.map((a, i) => <span key={i} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{describeAssertion(a)}</span>)}
      </div>
    </div>
  );
}

function GapList({ gaps }: { gaps: ValidationGap[] }) {
  return (
    <div className="border-b border-line bg-warn/5 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-warn"><ShieldAlert className="size-3.5" /> Missing validation detected ({gaps.length})</div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {gaps.slice(0, 10).map((g, i) => (
          <li key={i} className="text-xs">
            <Badge tone={g.severity === "high" ? "bad" : g.severity === "medium" ? "warn" : "muted"} className="mr-1.5">{g.severity}</Badge>
            <span className="text-fg">{g.issue}</span> <span className="text-faint">— {g.recommendation}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GenerateModal({ open, onClose, suiteId, onDone }: { open: boolean; onClose: () => void; suiteId: string; onDone: (gaps: ValidationGap[]) => void }) {
  const toast = useToast();
  const [source, setSource] = useState<"request" | "spec" | "endpoint">("request");
  const [requestId, setRequestId] = useState("");
  const [specId, setSpecId] = useState("");
  const [endpointIds, setEndpointIds] = useState<string[]>([]);
  const [method, setMethod] = useState<HttpMethod>("POST");
  const [url, setUrl] = useState("{{baseUrl}}/");
  const [body, setBody] = useState("");
  const [cats, setCats] = useState<TestCategory[]>(CATEGORIES);
  const [max, setMax] = useState(12);
  const collections = useQuery({ queryKey: ["collections"], queryFn: () => http.get<Collection[]>("/collections"), enabled: open });
  const specs = useQuery({ queryKey: ["specs"], queryFn: () => http.get<ApiSpecItem[]>("/openapi/specs"), enabled: open });
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => http.get<{ provider: string; model: string | null; notice?: string }>("/ai/status"), enabled: open });
  const spec = specs.data?.find((s) => s.id === specId);

  const gen = useMutation({
    mutationFn: () => {
      const src = source === "request" ? { type: "request", requestId } : source === "spec" ? { type: "spec", specId, endpointIds: endpointIds.length ? endpointIds : undefined } : { type: "endpoint", method, url, body: body || null };
      return http.post<{ cases: TestCase[]; validationGaps: ValidationGap[]; provider: string; notice: string | null }>("/ai/generate-tests", { suiteId, source: src, categories: cats, maxPerEndpoint: max });
    },
    onSuccess: (r) => {
      toast(`${r.cases.length} tests generated${r.provider === "claude" ? " by Claude" : ""} — review them below`);
      if (r.notice) toast(r.notice, "info");
      onDone(r.validationGaps);
      onClose();
    },
  });
  const valid = source === "request" ? !!requestId : source === "spec" ? !!specId : url.length > 3;

  return (
    <Modal wide open={open} onClose={onClose} title="Generate tests with AI" description="Generated tests are saved as drafts. You review and approve them before anything runs." footer={<Button variant="primary" icon={<Sparkles className="size-3.5" />} disabled={!valid || !cats.length} loading={gen.isPending} onClick={() => gen.mutate()}>{gen.isPending ? "Generating…" : "Generate tests"}</Button>}>
      <Tabs value={source} onChange={setSource} tabs={[{ id: "request", label: "Saved request" }, { id: "spec", label: "OpenAPI spec" }, { id: "endpoint", label: "Custom endpoint" }]} />
      <div className="mt-4 space-y-4">
        {source === "request" && (
          <Field label="Request">
            <Select value={requestId} onChange={(e) => setRequestId(e.target.value)}>
              <option value="">Choose a saved request…</option>
              {collections.data?.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.requests.map((r) => <option key={r.id} value={r.id}>{r.method} · {r.name}</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
        )}
        {source === "spec" && (
          <>
            {specs.data?.length === 0 ? (
              <p className="text-sm text-muted">No imported specs yet. <Link to="/openapi" className="text-accent hover:underline">Import an OpenAPI spec</Link> first.</p>
            ) : (
              <Field label="Specification">
                <Select value={specId} onChange={(e) => { setSpecId(e.target.value); setEndpointIds([]); }}>
                  <option value="">Choose a spec…</option>
                  {specs.data?.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.endpointCount} endpoints)</option>)}
                </Select>
              </Field>
            )}
            {spec && (
              <div>
                <span className="label">Endpoints <span className="text-faint">(none selected = first 15)</span></span>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-line">
                  {spec.endpoints.map((e) => (
                    <label key={e.id} className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[13px] last:border-0 hover:bg-surface-2">
                      <input type="checkbox" className="accent-accent" checked={endpointIds.includes(e.id)} onChange={(ev) => setEndpointIds(ev.target.checked ? [...endpointIds, e.id] : endpointIds.filter((x) => x !== e.id))} />
                      <MethodBadge method={e.method} className="w-10" />
                      <span className="font-mono text-[12px]">{e.path}</span>
                      <span className="truncate text-xs text-faint">{e.summary}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {source === "endpoint" && (
          <>
            <div className="flex gap-2">
              <Select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)} className="w-28">{METHODS.map((m) => <option key={m}>{m}</option>)}</Select>
              <Input aria-label="Endpoint URL" value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono" />
            </div>
            <Field label="Example JSON body (optional)" hint="Field names and types are inferred from this example.">
              <textarea value={body} onChange={(e) => setBody(e.target.value)} className="field code min-h-24" placeholder='{"email": "a@b.co", "age": 30}' />
            </Field>
          </>
        )}
        <div>
          <span className="label">Test categories</span>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <label key={c} className={cx("flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs capitalize transition-colors", cats.includes(c) ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-muted")}>
                <input type="checkbox" className="sr-only" checked={cats.includes(c)} onChange={(e) => setCats(e.target.checked ? [...cats, c] : cats.filter((x) => x !== c))} />
                {c}
              </label>
            ))}
          </div>
        </div>
        <Field label={`Max tests per endpoint: ${max}`}>
          <input type="range" min={3} max={25} value={max} onChange={(e) => setMax(Number(e.target.value))} className="w-full accent-accent" />
        </Field>
        <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          Engine: {ai.data?.provider === "claude" ? <>Claude <span className="font-mono">{ai.data.model}</span> — only endpoint shapes are sent; secret values never leave the server.</> : <>Built-in rule-based generator. {ai.data?.notice}</>}
        </p>
        {gen.isError && <p className="text-sm text-bad">{gen.error.message}</p>}
      </div>
    </Modal>
  );
}

function CaseEditor({ suiteId, testCase, onClose, onSaved }: { suiteId: string; testCase: TestCase | "new" | null; onClose: () => void; onSaved: () => void }) {
  const blank = { name: "", description: "", category: "positive" as TestCategory, method: "GET" as HttpMethod, url: "{{baseUrl}}/", headers: [] as KeyValue[], queryParams: [] as KeyValue[], body: "", assertions: [{ type: "status", operator: "equals", expected: 200 }] as Assertion[] };
  const [form, setForm] = useState(blank);
  const [tab, setTab] = useState<"assertions" | "headers" | "params" | "body">("assertions");
  useEffect(() => {
    if (testCase === "new") setForm(blank);
    else if (testCase) setForm({ ...testCase, description: testCase.description ?? "", body: testCase.body ?? "" });
    setTab("assertions");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testCase]);
  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, body: form.body || null, description: form.description || null };
      return testCase === "new" ? http.post(`/suites/${suiteId}/cases`, payload) : http.patch(`/cases/${(testCase as TestCase).id}`, payload);
    },
    onSuccess: () => { onSaved(); onClose(); },
  });
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  return (
    <Modal wide open={!!testCase} onClose={onClose} title={testCase === "new" ? "New test" : "Edit test"} footer={<Button variant="primary" loading={save.isPending} disabled={!form.name.trim() || !form.url.trim()} onClick={() => save.mutate()}>Save test</Button>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <Field label="Name"><Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Create user returns 201" /></Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => set({ category: e.target.value as TestCategory })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
        </div>
        <div className="flex gap-2">
          <Select aria-label="Method" value={form.method} onChange={(e) => set({ method: e.target.value as HttpMethod })} className="w-28">{METHODS.map((m) => <option key={m}>{m}</option>)}</Select>
          <Input aria-label="URL" value={form.url} onChange={(e) => set({ url: e.target.value })} className="font-mono" />
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "assertions", label: "Assertions", count: form.assertions.length }, { id: "headers", label: "Headers", count: form.headers.length }, { id: "params", label: "Params", count: form.queryParams.length }, { id: "body", label: "Body" }]} />
        {tab === "assertions" && <AssertionEditor value={form.assertions} onChange={(assertions) => set({ assertions })} />}
        {tab === "headers" && <KeyValueEditor rows={form.headers} onChange={(headers) => set({ headers })} keyPlaceholder="Header" />}
        {tab === "params" && <KeyValueEditor rows={form.queryParams} onChange={(queryParams) => set({ queryParams })} keyPlaceholder="Parameter" />}
        {tab === "body" && <textarea aria-label="Body" value={form.body} onChange={(e) => set({ body: e.target.value })} className="field code min-h-32" />}
        {save.isError && <p className="text-sm text-bad">{save.error.message}</p>}
      </div>
    </Modal>
  );
}
