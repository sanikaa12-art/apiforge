import { Plus, Trash2 } from "lucide-react";
import type { Assertion, AssertionOperator, AssertionType } from "../lib/types";
import { IconButton, Button } from "./ui";

const TYPES: { id: AssertionType; label: string; ops: AssertionOperator[]; pathLabel?: string }[] = [
  { id: "status", label: "Status code", ops: ["equals", "notEquals", "in", "lessThan", "greaterThan"] },
  { id: "jsonPath", label: "JSON body", ops: ["exists", "notExists", "equals", "notEquals", "contains", "type", "lengthGreaterThan", "matches", "greaterThan", "lessThan"], pathLabel: "data.items[0].id" },
  { id: "header", label: "Header", ops: ["exists", "notExists", "equals", "contains"], pathLabel: "content-type" },
  { id: "bodyContains", label: "Body text", ops: ["contains", "notContains", "matches"] },
  { id: "responseTime", label: "Response time (ms)", ops: ["lessThan"] },
];
const NO_VALUE: AssertionOperator[] = ["exists", "notExists"];

export function describeAssertion(a: Assertion) {
  const t = TYPES.find((x) => x.id === a.type);
  const exp = NO_VALUE.includes(a.operator) ? "" : ` ${Array.isArray(a.expected) ? a.expected.join(", ") : String(a.expected ?? "")}`;
  return `${t?.label ?? a.type}${a.path ? ` ${a.path}` : ""} ${a.operator}${exp}`;
}

function toExpected(raw: string, a: Assertion): Assertion["expected"] {
  if (a.operator === "in") return raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => (/^-?\d+$/.test(s) ? Number(s) : s));
  if (a.type === "status" || a.type === "responseTime" || a.operator === "lengthGreaterThan" || a.operator === "lessThan" || a.operator === "greaterThan") return raw === "" ? "" : Number.isNaN(Number(raw)) ? raw : Number(raw);
  if (raw === "true" || raw === "false") return raw === "true";
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

export function AssertionEditor({ value, onChange }: { value: Assertion[]; onChange: (v: Assertion[]) => void }) {
  const set = (i: number, patch: Partial<Assertion>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="space-y-2">
      {value.map((a, i) => {
        const meta = TYPES.find((t) => t.id === a.type)!;
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
            <select aria-label="Assertion type" value={a.type} onChange={(e) => { const t = TYPES.find((x) => x.id === e.target.value)!; set(i, { type: t.id, operator: t.ops[0]!, path: t.pathLabel ? a.path ?? "" : null }); }} className="field h-8 w-auto py-0 text-xs">
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {meta.pathLabel && <input aria-label="Path" value={a.path ?? ""} onChange={(e) => set(i, { path: e.target.value })} placeholder={meta.pathLabel} className="field h-8 w-40 py-0 font-mono text-xs" />}
            <select aria-label="Operator" value={a.operator} onChange={(e) => set(i, { operator: e.target.value as AssertionOperator })} className="field h-8 w-auto py-0 text-xs">
              {meta.ops.map((o) => <option key={o}>{o}</option>)}
            </select>
            {!NO_VALUE.includes(a.operator) && (
              <input aria-label="Expected value" value={Array.isArray(a.expected) ? a.expected.join(", ") : String(a.expected ?? "")} onChange={(e) => set(i, { expected: toExpected(e.target.value, a) })} placeholder={a.operator === "in" ? "400, 422" : a.operator === "type" ? "array" : "expected"} className="field h-8 min-w-24 flex-1 py-0 font-mono text-xs" />
            )}
            <IconButton label="Remove assertion" className="ml-auto" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></IconButton>
          </div>
        );
      })}
      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange([...value, { type: "status", operator: "equals", expected: 200 }])}>Add assertion</Button>
    </div>
  );
}
