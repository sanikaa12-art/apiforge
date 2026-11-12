import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Copy, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { http } from "../lib/api";
import type { Collection, RequestSummary } from "../lib/types";
import { Button, ConfirmButton, EmptyState, ErrorState, Field, IconButton, Input, MethodBadge, Modal, PageHeader, Select, Skeleton, useToast } from "../components/ui";

type Dialog = { kind: "collection"; collection?: Collection } | { kind: "folder"; collectionId: string; folder?: { id: string; name: string } } | { kind: "moveRequest"; collection: Collection; request: RequestSummary } | null;

export default function Collections() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["collections"], queryFn: () => http.get<Collection[]>("/collections") });
  const [dialog, setDialog] = useState<Dialog>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["collections"] });
  const onError = (e: Error) => toast(e.message, "bad");

  const del = useMutation({ mutationFn: (p: string) => http.del(p), onSuccess: () => { void refresh(); toast("Deleted"); }, onError });
  const dup = useMutation({ mutationFn: (id: string) => http.post(`/requests/${id}/duplicate`), onSuccess: () => { void refresh(); toast("Request duplicated"); }, onError });

  return (
    <div className="animate-fade-in">
      <PageHeader title="Collections" description="Organise saved requests into collections and folders." actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialog({ kind: "collection" })}>New collection</Button>} />
      {q.isLoading ? (
        <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : q.isError ? (
        <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
      ) : !q.data?.length ? (
        <div className="card"><EmptyState icon={<Boxes className="size-5" />} title="No collections yet" description="Collections keep related requests together so you can reuse them and generate tests." action={<Button variant="primary" onClick={() => setDialog({ kind: "collection" })}>Create a collection</Button>} /></div>
      ) : (
        <div className="space-y-4">
          {q.data.map((c) => {
            const groups = [...c.folders.map((f) => ({ folder: f, items: c.requests.filter((r) => r.folderId === f.id) })), { folder: null, items: c.requests.filter((r) => !r.folderId) }];
            return (
              <section key={c.id} className="card overflow-hidden">
                <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold">{c.name}</h2>
                    {c.description && <p className="truncate text-xs text-muted">{c.description}</p>}
                  </div>
                  <Button size="sm" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => setDialog({ kind: "folder", collectionId: c.id })}>Folder</Button>
                  <Link to="/workspace"><Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />}>Request</Button></Link>
                  <IconButton label="Rename collection" onClick={() => setDialog({ kind: "collection", collection: c })}><Pencil className="size-3.5" /></IconButton>
                  <ConfirmButton size="sm" variant="ghost" message={`Delete "${c.name}" and its ${c.requests.length} request(s)? This cannot be undone.`} onConfirm={() => del.mutate(`/collections/${c.id}`)} icon={<Trash2 className="size-3.5" />} aria-label="Delete collection" />
                </header>
                {c.requests.length === 0 && c.folders.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-faint">Empty collection — save a request from the API client.</p>
                ) : (
                  groups.map(({ folder, items }) =>
                    folder || items.length ? (
                      <div key={folder?.id ?? "root"}>
                        {folder && (
                          <div className="group flex items-center gap-2 bg-surface-2/50 px-4 py-1.5 text-xs font-medium text-muted">
                            {folder.name} <span className="text-faint">· {items.length}</span>
                            <div className="ml-auto flex opacity-0 group-hover:opacity-100">
                              <IconButton label="Rename folder" onClick={() => setDialog({ kind: "folder", collectionId: c.id, folder })}><Pencil className="size-3" /></IconButton>
                              <IconButton label="Delete folder" onClick={() => del.mutate(`/folders/${folder.id}`)}><Trash2 className="size-3" /></IconButton>
                            </div>
                          </div>
                        )}
                        {items.map((r) => (
                          <div key={r.id} className="group flex items-center gap-3 border-t border-line px-4 py-2 hover:bg-surface-2/40">
                            <MethodBadge method={r.method} className="w-10 shrink-0" />
                            <Link to={`/workspace?request=${r.id}`} className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-medium hover:text-accent">{r.name}</div>
                              <div className="truncate font-mono text-[11.5px] text-faint">{r.url}</div>
                            </Link>
                            <div className="flex opacity-60 group-hover:opacity-100">
                              {c.folders.length > 0 && <IconButton label="Move to folder" onClick={() => setDialog({ kind: "moveRequest", collection: c, request: r })}><FolderPlus className="size-3.5" /></IconButton>}
                              <IconButton label="Duplicate" onClick={() => dup.mutate(r.id)}><Copy className="size-3.5" /></IconButton>
                              <IconButton label="Delete request" onClick={() => del.mutate(`/requests/${r.id}`)}><Trash2 className="size-3.5" /></IconButton>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null,
                  )
                )}
              </section>
            );
          })}
        </div>
      )}
      <EditDialog dialog={dialog} onClose={() => setDialog(null)} onDone={() => { void refresh(); setDialog(null); }} />
    </div>
  );
}

function EditDialog({ dialog, onClose, onDone }: { dialog: Dialog; onClose: () => void; onDone: () => void }) {
  const initial = dialog?.kind === "collection" ? dialog.collection?.name ?? "" : dialog?.kind === "folder" ? dialog.folder?.name ?? "" : "";
  const [name, setName] = useState(initial);
  const [description, setDescription] = useState(dialog?.kind === "collection" ? dialog.collection?.description ?? "" : "");
  const [folderId, setFolderId] = useState(dialog?.kind === "moveRequest" ? dialog.request.folderId ?? "" : "");
  const [key, setKey] = useState<Dialog>(null);
  if (dialog !== key) {
    setKey(dialog);
    setName(initial);
    setDescription(dialog?.kind === "collection" ? dialog.collection?.description ?? "" : "");
    setFolderId(dialog?.kind === "moveRequest" ? dialog.request.folderId ?? "" : "");
  }
  const save = useMutation({
    mutationFn: async () => {
      if (!dialog) return;
      if (dialog.kind === "collection") return dialog.collection ? http.patch(`/collections/${dialog.collection.id}`, { name, description }) : http.post("/collections", { name, description });
      if (dialog.kind === "folder") return dialog.folder ? http.patch(`/folders/${dialog.folder.id}`, { name }) : http.post(`/collections/${dialog.collectionId}/folders`, { name });
      return http.patch(`/requests/${dialog.request.id}`, { folderId: folderId || null });
    },
    onSuccess: onDone,
  });
  const title = !dialog ? "" : dialog.kind === "collection" ? (dialog.collection ? "Rename collection" : "New collection") : dialog.kind === "folder" ? (dialog.folder ? "Rename folder" : "New folder") : "Move request";
  return (
    <Modal open={!!dialog} onClose={onClose} title={title} footer={<Button variant="primary" loading={save.isPending} disabled={dialog?.kind !== "moveRequest" && !name.trim()} onClick={() => save.mutate()}>Save</Button>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {dialog?.kind === "moveRequest" ? (
          <Field label="Folder">
            <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">— Collection root —</option>
              {dialog.collection.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        )}
        {dialog?.kind === "collection" && <Field label="Description (optional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>}
        {save.isError && <p className="text-sm text-bad">{save.error.message}</p>}
      </form>
    </Modal>
  );
}
