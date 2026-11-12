import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { http } from "../lib/api";
import { useEnvironment } from "../lib/environment";
import { timeAgo } from "../lib/format";
import type { SuiteListItem } from "../lib/types";
import { Badge, Button, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton } from "../components/ui";

export default function Suites() {
  const q = useQuery({ queryKey: ["suites"], queryFn: () => http.get<SuiteListItem[]>("/suites") });
  const [open, setOpen] = useState(false);
  return (
    <div className="animate-fade-in">
      <PageHeader title="Test suites" description="Automated API tests with assertions, AI-generated edge cases and regression tracking." actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>New suite</Button>} />
      {q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : q.isError ? (
        <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
      ) : !q.data?.length ? (
        <div className="card"><EmptyState icon={<FlaskConical className="size-5" />} title="No test suites yet" description="Create a suite, then add tests manually or let AI generate them from a request or OpenAPI spec." action={<Button variant="primary" onClick={() => setOpen(true)}>Create a suite</Button>} /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {q.data.map((s) => {
            const rate = s.lastRun && s.lastRun.total ? s.lastRun.passed / s.lastRun.total : null;
            return (
              <Link key={s.id} to={`/tests/${s.id}`} className="card group p-4 transition-colors hover:border-line-strong">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold group-hover:text-accent">{s.name}</h2>
                    <p className="mt-0.5 truncate text-xs text-muted">{s.description || "No description"}</p>
                  </div>
                  {s.draftCount > 0 && <Badge tone="accent">{s.draftCount} to review</Badge>}
                </div>
                <div className="mt-4 flex items-center gap-3 text-xs text-muted">
                  <span>{s._count.cases} tests</span>
                  {s.environment && <span>· {s.environment.name}</span>}
                  <span className="ml-auto">
                    {s.lastRun ? (
                      <span className="flex items-center gap-2">
                        <Badge tone={s.lastRun.status !== "COMPLETED" ? "muted" : rate === 1 ? "ok" : "bad"}>{s.lastRun.status === "COMPLETED" ? `${s.lastRun.passed}/${s.lastRun.total} passed` : s.lastRun.status.toLowerCase()}</Badge>
                        {timeAgo(s.lastRun.createdAt)}
                      </span>
                    ) : (
                      "Never run"
                    )}
                  </span>
                </div>
                {rate !== null && (
                  <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
                    <div className="bg-ok" style={{ width: `${rate * 100}%` }} />
                    <div className="flex-1 bg-bad/70" style={{ display: rate < 1 ? undefined : "none" }} />
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
      <NewSuiteModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export function NewSuiteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { environments, activeId } = useEnvironment();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [environmentId, setEnvironmentId] = useState<string>(activeId ?? "");
  const create = useMutation({
    mutationFn: () => http.post<{ id: string }>("/suites", { name, description, environmentId: environmentId || null }),
    onSuccess: (s) => { void qc.invalidateQueries({ queryKey: ["suites"] }); onClose(); navigate(`/tests/${s.id}`); },
  });
  return (
    <Modal open={open} onClose={onClose} title="New test suite" footer={<Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create suite</Button>}>
      <div className="space-y-4">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Checkout API — regression" /></Field>
        <Field label="Description (optional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Environment" hint="Variables from this environment are used when the suite runs.">
          <Select value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)}>
            <option value="">None</option>
            {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
        {create.isError && <p className="text-sm text-bad">{create.error.message}</p>}
      </div>
    </Modal>
  );
}
