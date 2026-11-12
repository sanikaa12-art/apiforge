import { Plus, Trash2 } from "lucide-react";
import type { KeyValue } from "../lib/types";
import { IconButton, cx } from "./ui";

/** Editable table of key/value rows. Always keeps one empty row at the bottom for quick entry. */
export function KeyValueEditor({ rows, onChange, keyPlaceholder = "Key", valuePlaceholder = "Value", readOnly }: { rows: KeyValue[]; onChange: (rows: KeyValue[]) => void; keyPlaceholder?: string; valuePlaceholder?: string; readOnly?: boolean }) {
  const display = readOnly ? rows : [...rows, { key: "", value: "", enabled: true }];
  const update = (i: number, patch: Partial<KeyValue>) => {
    const next = [...rows];
    if (i >= rows.length) next.push({ key: "", value: "", enabled: true, ...patch });
    else next[i] = { ...next[i]!, ...patch };
    onChange(next);
  };
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full table-fixed text-[13px]">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-[11px] uppercase tracking-wider text-faint">
            <th className="w-9" />
            <th className="px-2 py-1.5 font-medium">{keyPlaceholder}</th>
            <th className="px-2 py-1.5 font-medium">{valuePlaceholder}</th>
            <th className="w-9" />
          </tr>
        </thead>
        <tbody>
          {display.map((row, i) => {
            const isGhost = i >= rows.length;
            return (
              <tr key={i} className={cx("group border-b border-line last:border-0", !row.enabled && !isGhost && "opacity-50")}>
                <td className="text-center">
                  {!isGhost && <input type="checkbox" aria-label="Enabled" checked={row.enabled} disabled={readOnly} onChange={(e) => update(i, { enabled: e.target.checked })} className="size-3.5 accent-accent" />}
                </td>
                <td className="border-r border-line">
                  <input aria-label={`${keyPlaceholder} ${i + 1}`} value={row.key} readOnly={readOnly} placeholder={isGhost ? `Add ${keyPlaceholder.toLowerCase()}` : ""} onChange={(e) => update(i, { key: e.target.value })} className="w-full bg-transparent px-2 py-1.5 font-mono text-[12.5px] outline-none placeholder:text-faint" />
                </td>
                <td>
                  <input aria-label={`${valuePlaceholder} ${i + 1}`} value={row.value} readOnly={readOnly} onChange={(e) => update(i, { value: e.target.value })} className="w-full bg-transparent px-2 py-1.5 font-mono text-[12.5px] outline-none" />
                </td>
                <td className="text-center">
                  {!isGhost && !readOnly && (
                    <IconButton label="Remove row" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  )}
                  {isGhost && <Plus className="mx-auto size-3.5 text-faint" />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
