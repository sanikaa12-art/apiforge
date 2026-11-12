import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, Link2, Sparkles, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { http } from "../lib/api";
import { useEnvironment } from "../lib/environment";
import { timeAgo } from "../lib/format";
import type { ApiSpecItem, ParsedSpec } from "../lib/types";
import { Badge, Button, EmptyState, Field, IconButton, Input, MethodBadge, PageHeader, Tabs, useToast } from "../components/ui";

const SAMPLE = `openapi: 3.0.3
info: { title: Bookstore API, version: "1.0.0" }
servers: [{ url: "https://bookstore.example.com/v1" }]
paths:
  /books:
    get:
      tags: [books]
      summary: List books
      parameters: [{ name: limit, in: query, schema: { type: integer, maximum: 100 } }]
      responses: { "200": { description: OK } }
    post:
      tags: [books]
      summary: Create a book
      security: [{ bearer: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [title, author]
              properties:
                title: { type: string, maxLength: 200 }
                author: { type: string }
                price: { type: number, minimum: 0 }
      responses: { "201": { description: Created }, "422": { description: Invalid } }
  /books/{id}:
    get:
      tags: [books]
      summary: Get a book
      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
      responses: { "200": { description: OK }, "404": { description: Not found } }
components:
  securitySchemes: { bearer: { type: http, scheme: bearer } }`;

export default function OpenApiImport() {
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<ParsedSpec | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { setActiveId } = useEnvironment();
  const specs = useQuery({ queryKey: ["specs"], queryFn: () => http.get<ApiSpecItem[]>("/openapi/specs") });
  const source = mode === "paste" ? { content } : { url };

  const doPreview = useMutation({ mutationFn: () => http.post<ParsedSpec>("/openapi/preview", source), onSuccess: setPreview, onError: () => setPreview(null) });
  const doImport = useMutation({
    mutationFn: () => http.post<{ specId: string; collectionId: string; environmentId: string | null; endpointCount: number; title: string }>("/openapi/import", source),
    onSuccess: (r) => {
      for (const k of ["collections", "environments", "specs"]) void qc.invalidateQueries({ queryKey: [k] });
      if (r.environmentId) setActiveId(r.environmentId);
      toast(`Imported ${r.endpointCount} endpoints from ${r.title}`);
      setPreview(null);
      setContent("");
    },
  });
  const genSuite = useMutation({
    mutationFn: async (s: ApiSpecItem) => {
      const suite = await http.post<{ id: string }>("/suites", { name: `${s.title} — generated tests` });
      await http.post("/ai/generate-tests", { suiteId: suite.id, source: { type: "spec", specId: s.id }, maxPerEndpoint: 8 });
      return suite.id;
    },
    onSuccess: (id) => navigate(`/tests/${id}`),
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const del = useMutation({ mutationFn: (id: string) => http.del(`/openapi/specs/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["specs"] }) });

  return (
    <div className="animate-fade-in">
      <PageHeader title="OpenAPI import" description="Import a Swagger 2.0 or OpenAPI 3.x spec to generate a ready-to-use collection, an environment, and AI test cases." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px] [&>*]:min-w-0">
        <section className="card p-4">
          <Tabs value={mode} onChange={(m) => { setMode(m); setPreview(null); }} tabs={[{ id: "paste", label: "Paste or upload" }, { id: "url", label: "From URL" }]} />
          <div className="mt-4 space-y-3">
            {mode === "paste" ? (
              <>
                <textarea aria-label="OpenAPI specification" value={content} onChange={(e) => { setContent(e.target.value); setPreview(null); }} spellCheck={false} placeholder="Paste JSON or YAML…" className="field code min-h-72" />
                <div className="flex flex-wrap gap-2">
                  <input ref={fileRef} type="file" accept=".json,.yaml,.yml" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setContent(await f.text()); setPreview(null); } e.target.value = ""; }} />
                  <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>Upload file</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setContent(SAMPLE); setPreview(null); }}>Use sample spec</Button>
                </div>
              </>
            ) : (
              <Field label="Spec URL" hint="Fetched through the same SSRF-protected engine as every request — private and internal addresses are blocked.">
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://petstore3.swagger.io/api/v3/openapi.json" />
              </Field>
            )}
            {(doPreview.isError || doImport.isError) && <p role="alert" className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{(doPreview.error ?? doImport.error)?.message}</p>}
            <div className="flex justify-end gap-2">
              <Button disabled={mode === "paste" ? !content.trim() : !url} loading={doPreview.isPending} onClick={() => doPreview.mutate()}>Preview</Button>
              <Button variant="primary" disabled={!preview} loading={doImport.isPending} onClick={() => doImport.mutate()}>Import {preview ? `${preview.endpoints.length} endpoints` : ""}</Button>
            </div>
          </div>
          {preview && (
            <div className="mt-4 rounded-lg border border-line animate-fade-in">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <span className="text-sm font-semibold">{preview.title}</span>
                {preview.version && <Badge>v{preview.version}</Badge>}
                <Badge tone="info">OpenAPI {preview.specVersion}</Badge>
                <span className="ml-auto truncate font-mono text-xs text-faint">{preview.baseUrl}</span>
              </div>
              <ul className="max-h-72 overflow-y-auto">
                {preview.endpoints.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 border-b border-line px-3 py-1.5 text-[13px] last:border-0">
                    <MethodBadge method={e.method} className="w-10" />
                    <span className="font-mono text-[12px]">{e.path}</span>
                    <span className="truncate text-xs text-muted">{e.summary}</span>
                    {e.secured && <Badge className="ml-auto">auth</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="card h-fit">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">Imported specs</div>
          {specs.data?.length ? (
            <ul>
              {specs.data.map((s) => (
                <li key={s.id} className="border-b border-line px-4 py-3 last:border-0">
                  <div className="flex items-start gap-2">
                    <FileCode2 className="mt-0.5 size-4 text-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{s.title}</div>
                      <div className="text-xs text-faint">{s.endpointCount} endpoints · {timeAgo(s.createdAt)}</div>
                    </div>
                    <IconButton label="Delete spec" onClick={() => del.mutate(s.id)}><Trash2 className="size-3.5" /></IconButton>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5 text-accent" />} loading={genSuite.isPending && genSuite.variables?.id === s.id} onClick={() => genSuite.mutate(s)}>Generate tests</Button>
                    {s.collectionId && <Link to="/collections"><Button size="sm" variant="ghost" icon={<Link2 className="size-3.5" />}>Collection</Button></Link>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<FileCode2 className="size-5" />} title="No specs yet" description="Imported specs can be reused for AI test generation." />
          )}
        </aside>
      </div>
    </div>
  );
}
