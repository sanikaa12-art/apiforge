import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Layers, Lock, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { http } from "../lib/api";
import { useEnvironment } from "../lib/environment";
import type { EnvVariable, Environment, EnvironmentKind } from "../lib/types";
import { Badge, Button, ConfirmButton, EmptyState, Field, IconButton, Input, LoadingBlock, Modal, PageHeader, Select, cx, useToast } from "../components/ui";

const kindTone: Record<EnvironmentKind, "ok" | "warn" | "bad" | "info"> = { DEVELOPMENT: "ok", STAGING: "warn", PRODUCTION: "bad", CUSTOM: "info" };

export default function Environments() {
  const { environments, isLoading, activeId, setActiveId } = useEnvironment();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const current = environments.find((e) => e.id === (selected ?? activeId)) ?? environments[0];

  return (
    <div className="animate-fade-in">
      <PageHeader title="Environments" description="Variables like {{baseUrl}} are substituted on the server when a request runs. Secrets are encrypted and never sent back to the browser." actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New environment</Button>} />
      {isLoading ? (
        <LoadingBlock />
      ) : !environments.length ? (
        <div className="card"><EmptyState icon={<Layers className="size-5" />} title="No environments" description="Create Development, Staging and Production environments to switch targets with one click." action={<Button variant="primary" onClick={() => setCreating(true)}>Create environment</Button>} /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[220px_1fr] [&>*]:min-w-0">
          <div className="space-y-1">
            {environments.map((e) => (
              <button key={e.id} onClick={() => setSelected(e.id)} className={cx("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px]", current?.id === e.id ? "bg-surface-3 shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:bg-surface-2")}>
                <span className="flex-1 truncate font-medium">{e.name}</span>
                {activeId === e.id && <Badge tone="accent">Active</Badge>}
              </button>
            ))}
          </div>
          {current && <EnvEditor key={current.id} env={current} isActive={activeId === current.id} onActivate={() => setActiveId(current.id)} />}
        </div>
      )}
      <CreateEnvModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => setSelected(id)} />
    </div>
  );
}

function EnvEditor({ env, isActive, onActivate }: { env: Environment; isActive: boolean; onActivate: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [vars, setVars] = useState<EnvVariable[]>(env.variables);
  const [reveal, setReveal] = useState<Record<number, boolean>>({});
  useEffect(() => setVars(env.variables), [env.variables]);
  const dirty = JSON.stringify(vars) !== JSON.stringify(env.variables);

  const save = useMutation({
    mutationFn: () => http.put<Environment>(`/environments/${env.id}/variables`, { variables: vars.filter((v) => v.key.trim()).map((v) => ({ id: v.id, key: v.key.trim(), isSecret: v.isSecret, ...(v.isSecret && !v.value && v.hasValue ? {} : { value: v.value }) })) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["environments"] }); toast("Variables saved"); },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const remove = useMutation({ mutationFn: () => http.del(`/environments/${env.id}`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["environments"] }); toast("Environment deleted"); } });
  const set = (i: number, p: Partial<EnvVariable>) => setVars((vs) => vs.map((v, j) => (j === i ? { ...v, ...p } : v)));

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{env.name}</h2>
        <Badge tone={kindTone[env.kind]}>{env.kind.toLowerCase()}</Badge>
        <div className="ml-auto flex gap-2">
          {!isActive && <Button size="sm" onClick={onActivate}>Set active</Button>}
          <ConfirmButton size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} message={`Delete environment "${env.name}" and all of its variables? This cannot be undone.`} onConfirm={() => remove.mutate()}>Delete</ConfirmButton>
        </div>
      </div>
      <div className="p-4">
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="grid grid-cols-[1fr_1.4fr_88px_36px] border-b border-line bg-surface-2 px-2 py-1.5 text-[11px] uppercase tracking-wider text-faint">
            <span className="px-1">Variable</span><span className="px-1">Value</span><span className="text-center">Secret</span><span />
          </div>
          {vars.length === 0 && <p className="px-3 py-6 text-center text-sm text-faint">No variables yet.</p>}
          {vars.map((v, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_88px_36px] items-center border-b border-line px-2 last:border-0">
              <input aria-label="Variable name" value={v.key} onChange={(e) => set(i, { key: e.target.value })} placeholder="baseUrl" className="bg-transparent px-1 py-2 font-mono text-[12.5px] outline-none" />
              <div className="flex items-center">
                <input
                  aria-label={`Value of ${v.key}`}
                  type={v.isSecret && !reveal[i] ? "password" : "text"}
                  value={v.value}
                  onChange={(e) => set(i, { value: e.target.value })}
                  placeholder={v.isSecret && v.hasValue ? "•••••••• (stored — type to replace)" : "value"}
                  className="min-w-0 flex-1 bg-transparent px-1 py-2 font-mono text-[12.5px] outline-none placeholder:text-faint"
                />
                {v.isSecret && v.value && (
                  <IconButton label={reveal[i] ? "Hide" : "Show"} onClick={() => setReveal((r) => ({ ...r, [i]: !r[i] }))}>{reveal[i] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</IconButton>
                )}
              </div>
              <label className="flex items-center justify-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={v.isSecret} onChange={(e) => set(i, { isSecret: e.target.checked })} className="accent-accent" />
                <Lock className={cx("size-3", v.isSecret ? "text-accent" : "text-faint")} />
              </label>
              <IconButton label="Remove variable" onClick={() => setVars((vs) => vs.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></IconButton>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setVars((vs) => [...vs, { key: "", value: "", isSecret: false }])}>Add variable</Button>
          <span className="ml-auto text-xs text-faint">Use as <code className="kbd">{"{{name}}"}</code> · built-ins: <code className="kbd">{"{{$randomUUID}}"}</code> <code className="kbd">{"{{$timestamp}}"}</code></span>
          <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        </div>
      </div>
    </div>
  );
}

function CreateEnvModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<EnvironmentKind>("DEVELOPMENT");
  const [baseUrl, setBaseUrl] = useState("");
  const create = useMutation({
    mutationFn: () => http.post<Environment>("/environments", { name, kind, variables: baseUrl ? [{ key: "baseUrl", value: baseUrl }] : [] }),
    onSuccess: (e) => { void qc.invalidateQueries({ queryKey: ["environments"] }); onCreated(e.id); onClose(); setName(""); setBaseUrl(""); },
  });
  return (
    <Modal open={open} onClose={onClose} title="New environment" footer={<Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create</Button>}>
      <div className="space-y-4">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Staging" /></Field>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as EnvironmentKind)}>
            <option value="DEVELOPMENT">Development</option><option value="STAGING">Staging</option><option value="PRODUCTION">Production</option><option value="CUSTOM">Custom</option>
          </Select>
        </Field>
        <Field label="Base URL (optional)" hint="Creates a {{baseUrl}} variable."><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://staging.api.example.com" /></Field>
        {create.isError && <p className="text-sm text-bad">{create.error.message}</p>}
      </div>
    </Modal>
  );
}
