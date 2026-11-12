import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Clock, Folder as FolderIcon, History as HistoryIcon, Plus, Save, Send, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { http } from "../lib/api";
import { useEnvironment } from "../lib/environment";
import { formatBytes, formatMs, parseQuery, prettyJson, timeAgo } from "../lib/format";
import { METHODS, type Collection, type ExecuteResponse, type HistoryItem, type HttpMethod, type KeyValue, type SavedRequest, type SuiteListItem } from "../lib/types";
import { KeyValueEditor } from "../components/KeyValueEditor";
import { CodeView } from "../components/CodeView";
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, MethodBadge, Modal, Select, Skeleton, Spinner, StatusBadge, Tabs, cx, useToast } from "../components/ui";

interface Draft {
  id?: string;
  collectionId?: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  body: string;
  bodyType: SavedRequest["bodyType"];
}
const emptyDraft = (): Draft => ({ name: "Untitled request", method: "GET", url: "", headers: [], queryParams: [], body: "", bodyType: "none" });

function fullUrl(base: string, params: KeyValue[]) {
  const q = params.filter((p) => p.enabled && p.key).map((p) => `${p.key}=${p.value}`).join("&");
  return q ? `${base}?${q}` : base;
}

export default function Workspace() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"params" | "headers" | "body">("params");
  const [respTab, setRespTab] = useState<"body" | "headers">("body");
  const [pretty, setPretty] = useState(true);
  const [side, setSide] = useState<"collections" | "history">("collections");
  const [saveOpen, setSaveOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const { activeId, active } = useEnvironment();
  const toast = useToast();
  const qc = useQueryClient();

  const requestId = params.get("request");
  const saved = useQuery({ queryKey: ["request", requestId], queryFn: () => http.get<SavedRequest>(`/requests/${requestId}`), enabled: !!requestId });
  useEffect(() => {
    if (!saved.data) return;
    const r = saved.data;
    setDraft({ id: r.id, collectionId: r.collectionId, name: r.name, method: r.method, url: r.url, headers: r.headers, queryParams: r.queryParams, body: r.body ?? "", bodyType: r.bodyType });
    setDirty(false);
    setTab(r.body ? "body" : "params");
    send.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.data]);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const send = useMutation({
    mutationFn: () =>
      http.post<ExecuteResponse>("/execute", {
        method: draft.method,
        url: draft.url,
        headers: draft.headers,
        queryParams: draft.queryParams,
        body: draft.bodyType === "none" ? null : draft.body,
        environmentId: activeId,
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["history"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const canSend = draft.url.trim().length > 0 && !send.isPending;
  const doSend = useCallback(() => canSend && send.mutate(), [canSend, send]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        doSend();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        setSaveOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSend]);

  const usedVars = useMemo(() => {
    const text = [draft.url, ...draft.headers.map((h) => h.value), ...draft.queryParams.map((q) => q.value), draft.bodyType !== "none" ? draft.body : ""].join(" ");
    return [...new Set([...text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]!))];
  }, [draft]);
  const known = new Set(active?.variables.map((v) => v.key) ?? []);

  const newRequest = () => {
    setParams({});
    setDraft(emptyDraft());
    setDirty(false);
    send.reset();
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-surface/40 md:flex">
        <div className="flex items-center justify-between px-3 pt-3">
          <Tabs
            className="flex-1 border-0"
            value={side}
            onChange={setSide}
            tabs={[
              { id: "collections", label: "Collections" },
              { id: "history", label: "History" },
            ]}
          />
          <IconButton label="New request" onClick={newRequest}>
            <Plus className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">{side === "collections" ? <CollectionTree activeId={draft.id} /> : <HistoryList onPick={(h) => { setParams({}); setDraft({ ...emptyDraft(), method: h.method as HttpMethod, url: h.url, name: "From history" }); setDirty(true); }} />}</div>
      </aside>

      {/* Main */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <input aria-label="Request name" value={draft.name} onChange={(e) => update({ name: e.target.value })} className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none" />
          {dirty && <span className="size-1.5 rounded-full bg-warn" title="Unsaved changes" />}
          <Button size="sm" variant="ghost" icon={<Wand2 className="size-3.5" />} onClick={() => setGenOpen(true)} disabled={!draft.url}>
            Generate tests
          </Button>
          <Button size="sm" icon={<Save className="size-3.5" />} onClick={() => setSaveOpen(true)}>
            Save
          </Button>
        </div>

        <div className="px-4 pt-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              doSend();
            }}
          >
            <div className="flex min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-surface-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
              <select aria-label="HTTP method" value={draft.method} onChange={(e) => update({ method: e.target.value as HttpMethod })} className="border-r border-line bg-surface-3 px-3 font-mono text-xs font-semibold outline-none">
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                aria-label="Request URL"
                value={fullUrl(draft.url, draft.queryParams)}
                onChange={(e) => {
                  const { base, params: qp } = parseQuery(e.target.value);
                  update({ url: base, queryParams: [...qp, ...draft.queryParams.filter((p) => !p.enabled)] });
                }}
                placeholder="https://api.example.com/v1/users  — or {{baseUrl}}/users"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-faint"
              />
            </div>
            <Button type="submit" variant="primary" disabled={!canSend} loading={send.isPending} icon={<Send className="size-3.5" />}>
              Send
            </Button>
          </form>
          {usedVars.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-faint">
              Variables:
              {usedVars.map((v) => (
                <Badge key={v} tone={known.has(v) || v.startsWith("$") ? "accent" : "warn"}>
                  {v}
                  {!known.has(v) && !v.startsWith("$") && " · missing"}
                </Badge>
              ))}
              {!active && <span>— select an environment in the sidebar</span>}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="max-h-[45%] min-h-[180px] overflow-y-auto px-4">
            <Tabs
              className="sticky top-0 z-10 bg-bg pt-2"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "params", label: "Params", count: draft.queryParams.filter((q) => q.enabled && q.key).length },
                { id: "headers", label: "Headers", count: draft.headers.filter((h) => h.enabled && h.key).length },
                { id: "body", label: "Body", count: draft.bodyType !== "none" && draft.body ? 1 : 0 },
              ]}
            />
            <div className="py-3">
              {tab === "params" && <KeyValueEditor rows={draft.queryParams} onChange={(queryParams) => update({ queryParams })} keyPlaceholder="Parameter" />}
              {tab === "headers" && <KeyValueEditor rows={draft.headers} onChange={(headers) => update({ headers })} keyPlaceholder="Header" />}
              {tab === "body" && <BodyEditor draft={draft} update={update} />}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col border-t border-line bg-surface/30">
            <ResponsePanel send={send} respTab={respTab} setRespTab={setRespTab} pretty={pretty} setPretty={setPretty} />
          </div>
        </div>
      </section>

      <SaveModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        draft={draft}
        onSaved={(r) => {
          setDraft((d) => ({ ...d, id: r.id, collectionId: r.collectionId }));
          setDirty(false);
          setParams({ request: r.id });
          toast("Request saved");
        }}
      />
      <GenerateTestsModal open={genOpen} onClose={() => setGenOpen(false)} draft={draft} />
    </div>
  );
}

function BodyEditor({ draft, update }: { draft: Draft; update: (p: Partial<Draft>) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {(["none", "json", "text"] as const).map((t) => (
          <label key={t} className="flex items-center gap-1.5 text-muted">
            <input type="radio" name="bodyType" checked={draft.bodyType === t} onChange={() => update({ bodyType: t })} className="accent-accent" />
            {t === "none" ? "None" : t === "json" ? "JSON" : "Raw text"}
          </label>
        ))}
        {draft.bodyType === "json" && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              const p = prettyJson(draft.body);
              if (p.isJson) {
                update({ body: p.text });
                setError(null);
              } else setError("Body is not valid JSON");
            }}
          >
            Format JSON
          </Button>
        )}
      </div>
      {draft.bodyType === "none" ? (
        <p className="py-6 text-center text-sm text-faint">This request has no body.</p>
      ) : (
        <>
          <textarea
            aria-label="Request body"
            value={draft.body}
            spellCheck={false}
            onChange={(e) => {
              update({ body: e.target.value });
              setError(null);
            }}
            placeholder={draft.bodyType === "json" ? '{\n  "name": "Ada"\n}' : ""}
            className="field code min-h-40 resize-y"
          />
          {error && <p className="text-xs text-bad">{error}</p>}
        </>
      )}
    </div>
  );
}

function ResponsePanel({ send, respTab, setRespTab, pretty, setPretty }: { send: ReturnType<typeof useMutation<ExecuteResponse, Error, void>>; respTab: "body" | "headers"; setRespTab: (t: "body" | "headers") => void; pretty: boolean; setPretty: (v: boolean) => void }) {
  if (send.isPending)
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
        <Spinner /> Sending request…
      </div>
    );
  if (send.isError)
    return (
      <div className="flex-1 overflow-auto">
        <ErrorState error={send.error} onRetry={() => send.mutate()} />
      </div>
    );
  const r = send.data;
  if (!r)
    return (
      <div className="flex-1 overflow-auto">
        <EmptyState icon={<Send className="size-5" />} title="Send a request to see the response" description="Press ⌘/Ctrl + Enter to send, ⌘/Ctrl + S to save." />
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col animate-fade-in">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-2">
        <Tabs
          className="border-0"
          value={respTab}
          onChange={setRespTab}
          tabs={[
            { id: "body", label: "Body" },
            { id: "headers", label: "Headers", count: Object.keys(r.headers).length },
          ]}
        />
        <div className="ml-auto flex items-center gap-3 text-xs text-muted" data-testid="response-meta">
          <span className="flex items-center gap-1.5">
            Status <StatusBadge status={r.status} /> <span className="text-faint">{r.statusText}</span>
          </span>
          <span>
            Time <span className="font-medium text-fg">{formatMs(r.durationMs)}</span>
          </span>
          <span>
            Size <span className="font-medium text-fg">{formatBytes(r.sizeBytes)}</span>
          </span>
        </div>
      </div>
      {(r.truncated || r.unresolvedVariables.length > 0 || r.redirects.length > 0) && (
        <div className="mx-4 mt-2 space-y-1 text-xs">
          {r.truncated && <p className="text-warn">Response was larger than the limit and has been truncated.</p>}
          {r.unresolvedVariables.length > 0 && <p className="text-warn">Unresolved variables: {r.unresolvedVariables.join(", ")}</p>}
          {r.redirects.length > 0 && <p className="text-faint">Followed {r.redirects.length} redirect(s) → {r.redirects.at(-1)}</p>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {respTab === "body" ? (
          <>
            <div className="mb-2 flex justify-end gap-1">
              <Button size="sm" variant={pretty ? "secondary" : "ghost"} onClick={() => setPretty(true)}>
                Pretty
              </Button>
              <Button size="sm" variant={!pretty ? "secondary" : "ghost"} onClick={() => setPretty(false)}>
                Raw
              </Button>
            </div>
            {r.body ? <CodeView text={r.body} pretty={pretty} /> : <p className="text-sm text-faint">Empty response body.</p>}
          </>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            {Object.entries(r.headers).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[minmax(120px,240px)_1fr] border-b border-line text-[12.5px] last:border-0">
                <div className="border-r border-line bg-surface-2 px-3 py-1.5 font-mono text-muted">{k}</div>
                <div className="break-all px-3 py-1.5 font-mono">{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CollectionTree({ activeId }: { activeId?: string }) {
  const q = useQuery({ queryKey: ["collections"], queryFn: () => http.get<Collection[]>("/collections") });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [, setParams] = useSearchParams();
  const navigate = useNavigate();
  if (q.isLoading) return <div className="space-y-2 p-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6" />)}</div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState title="No collections yet" description="Save a request to start a collection." action={<Button size="sm" onClick={() => navigate("/collections")}>Manage collections</Button>} />;

  const item = (r: Collection["requests"][number], depth: number) => (
    <button key={r.id} onClick={() => setParams({ request: r.id })} className={cx("flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-[13px] transition-colors", activeId === r.id ? "bg-accent-soft text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")} style={{ paddingLeft: 8 + depth * 14 }}>
      <MethodBadge method={r.method} className="w-9 shrink-0 text-right" />
      <span className="truncate">{r.name}</span>
    </button>
  );
  return (
    <div className="space-y-0.5">
      {q.data.map((c) => {
        const isCollapsed = collapsed[c.id];
        return (
          <div key={c.id}>
            <button onClick={() => setCollapsed((s) => ({ ...s, [c.id]: !isCollapsed }))} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[13px] font-medium hover:bg-surface-2">
              {isCollapsed ? <ChevronRight className="size-3.5 text-faint" /> : <ChevronDown className="size-3.5 text-faint" />}
              <span className="truncate">{c.name}</span>
              <span className="ml-auto text-[11px] text-faint">{c.requests.length}</span>
            </button>
            {!isCollapsed && (
              <div className="mb-1">
                {c.folders.map((f) => (
                  <div key={f.id}>
                    <div className="flex items-center gap-1.5 py-1 pl-5 text-[12.5px] text-muted">
                      <FolderIcon className="size-3.5 text-faint" />
                      {f.name}
                    </div>
                    {c.requests.filter((r) => r.folderId === f.id).map((r) => item(r, 2))}
                  </div>
                ))}
                {c.requests.filter((r) => !r.folderId).map((r) => item(r, 1))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HistoryList({ onPick }: { onPick: (h: HistoryItem) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["history"], queryFn: () => http.get<{ items: HistoryItem[] }>("/history?limit=100") });
  const clear = useMutation({ mutationFn: () => http.del("/history"), onSuccess: () => qc.invalidateQueries({ queryKey: ["history"] }) });
  if (q.isLoading) return <div className="space-y-2 p-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-9" />)}</div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.items.length) return <EmptyState icon={<HistoryIcon className="size-5" />} title="No history yet" description="Requests you send will appear here." />;
  return (
    <div>
      <div className="flex justify-end px-1 pb-1">
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-3" />} onClick={() => clear.mutate()} loading={clear.isPending}>
          Clear
        </Button>
      </div>
      {q.data.items.map((h) => (
        <button key={h.id} onClick={() => onPick(h)} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
          <div className="flex items-center gap-2">
            <MethodBadge method={h.method} className="w-9 shrink-0" />
            <span className="truncate font-mono text-[12px] text-muted">{h.url.replace(/^https?:\/\//, "")}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 pl-11 text-[11px] text-faint">
            <StatusBadge status={h.status} error={h.error} />
            {h.durationMs != null && <span>{formatMs(h.durationMs)}</span>}
            <span className="ml-auto flex items-center gap-1">
              <Clock className="size-3" />
              {timeAgo(h.createdAt)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function SaveModal({ open, onClose, draft, onSaved }: { open: boolean; onClose: () => void; draft: Draft; onSaved: (r: SavedRequest) => void }) {
  const qc = useQueryClient();
  const collections = useQuery({ queryKey: ["collections"], queryFn: () => http.get<Collection[]>("/collections"), enabled: open });
  const [collectionId, setCollectionId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [name, setName] = useState(draft.name);
  const [newCollection, setNewCollection] = useState("");
  useEffect(() => {
    if (open) {
      setName(draft.name);
      setCollectionId(draft.collectionId ?? collections.data?.[0]?.id ?? "");
    }
  }, [open, draft, collections.data]);

  const payload = { name, method: draft.method, url: draft.url, headers: draft.headers, queryParams: draft.queryParams, body: draft.bodyType === "none" ? null : draft.body, bodyType: draft.bodyType };
  const save = useMutation({
    mutationFn: async (asNew: boolean) => {
      if (draft.id && !asNew) return http.patch<SavedRequest>(`/requests/${draft.id}`, payload);
      let cid = collectionId;
      if (!cid || newCollection) cid = (await http.post<Collection>("/collections", { name: newCollection || "My Collection" })).id;
      return http.post<SavedRequest>(`/collections/${cid}/requests`, { ...payload, folderId: folderId || null });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["collections"] });
      void qc.invalidateQueries({ queryKey: ["request", r.id] });
      onSaved(r);
      onClose();
    },
  });
  const folders = collections.data?.find((c) => c.id === collectionId)?.folders ?? [];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft.id ? "Save request" : "Save to collection"}
      footer={
        <>
          {draft.id && (
            <Button variant="ghost" onClick={() => save.mutate(true)} loading={save.isPending}>
              Save as new
            </Button>
          )}
          <Button variant="primary" onClick={() => save.mutate(false)} loading={save.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {(!draft.id || save.variables) && (
          <>
            {collections.data?.length ? (
              <Field label="Collection">
                <Select value={newCollection ? "" : collectionId} onChange={(e) => { setCollectionId(e.target.value); setNewCollection(""); setFolderId(""); }}>
                  {collections.data.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {folders.length > 0 && !newCollection && (
              <Field label="Folder (optional)">
                <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                  <option value="">— Collection root —</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={collections.data?.length ? "…or create a new collection" : "New collection name"}>
              <Input value={newCollection} onChange={(e) => setNewCollection(e.target.value)} placeholder="e.g. Payments API" />
            </Field>
          </>
        )}
        {save.isError && <p className="text-sm text-bad">{save.error.message}</p>}
      </div>
    </Modal>
  );
}

function GenerateTestsModal({ open, onClose, draft }: { open: boolean; onClose: () => void; draft: Draft }) {
  const navigate = useNavigate();
  const { activeId } = useEnvironment();
  const suites = useQuery({ queryKey: ["suites"], queryFn: () => http.get<SuiteListItem[]>("/suites"), enabled: open });
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => http.get<{ provider: string; model: string | null }>("/ai/status"), enabled: open });
  const [suiteId, setSuiteId] = useState("");
  const [newSuite, setNewSuite] = useState("");
  const gen = useMutation({
    mutationFn: async () => {
      let sid = suiteId;
      if (!sid || newSuite) sid = (await http.post<{ id: string }>("/suites", { name: newSuite || `${draft.name} tests`, environmentId: activeId })).id;
      const source = { type: "endpoint", method: draft.method, url: fullUrl(draft.url, draft.queryParams), body: draft.bodyType === "json" ? draft.body : null, secured: draft.headers.some((h) => h.enabled && h.key.toLowerCase() === "authorization") };
      await http.post("/ai/generate-tests", { suiteId: sid, source });
      return sid;
    },
    onSuccess: (sid) => {
      onClose();
      navigate(`/tests/${sid}?review=1`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate tests with AI"
      description="Creates positive, negative, edge-case and validation tests as drafts for you to review."
      footer={
        <Button variant="primary" icon={<Sparkles className="size-3.5" />} onClick={() => gen.mutate()} loading={gen.isPending}>
          Generate
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs">
          <MethodBadge method={draft.method} /> <span className="truncate">{fullUrl(draft.url, draft.queryParams)}</span>
        </div>
        {suites.data?.length ? (
          <Field label="Add to suite">
            <Select value={newSuite ? "" : suiteId} onChange={(e) => { setSuiteId(e.target.value); setNewSuite(""); }}>
              <option value="">— New suite —</option>
              {suites.data.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        {!suiteId && (
          <Field label="New suite name">
            <Input value={newSuite} onChange={(e) => setNewSuite(e.target.value)} placeholder={`${draft.name} tests`} />
          </Field>
        )}
        <p className="text-xs text-faint">Engine: {ai.data ? (ai.data.provider === "claude" ? `Claude (${ai.data.model})` : "built-in rule-based generator (no API key configured)") : "…"}</p>
        {gen.isError && <p className="text-sm text-bad">{gen.error.message}</p>}
      </div>
    </Modal>
  );
}
