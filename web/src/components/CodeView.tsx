import { useMemo } from "react";
import { prettyJson } from "../lib/format";

/** Lightweight JSON syntax highlighting (no heavy editor dependency). */
function highlight(json: string) {
  const parts: { text: string; cls: string }[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json))) {
    if (m.index > last) parts.push({ text: json.slice(last, m.index), cls: "" });
    if (m[1]) {
      parts.push({ text: m[1], cls: m[2] ? "text-[#9cc4ff]" : "text-[#a5e6b8]" });
      if (m[2]) parts.push({ text: m[2], cls: "text-faint" });
    } else if (m[3]) parts.push({ text: m[3], cls: "text-[#ff9ec7]" });
    else if (m[4]) parts.push({ text: m[4], cls: "text-[#ffc982]" });
    else parts.push({ text: m[5]!, cls: "text-faint" });
    last = re.lastIndex;
  }
  if (last < json.length) parts.push({ text: json.slice(last), cls: "" });
  return parts;
}

export function CodeView({ text, pretty = true, maxHeight }: { text: string; pretty?: boolean; maxHeight?: string }) {
  const { text: shown, isJson } = useMemo(() => (pretty ? prettyJson(text) : { text, isJson: false }), [text, pretty]);
  const tokens = useMemo(() => (isJson && shown.length < 400_000 ? highlight(shown) : null), [shown, isJson]);
  const lines = useMemo(() => shown.split("\n").length, [shown]);
  return (
    <div className="flex overflow-auto rounded-lg border border-line bg-[#0d0f13]" style={{ maxHeight }}>
      <pre aria-hidden className="code select-none border-r border-line px-2.5 py-3 text-right text-faint/70">
        {Array.from({ length: Math.min(lines, 20000) }, (_, i) => i + 1).join("\n")}
      </pre>
      <pre className="code min-w-0 flex-1 whitespace-pre px-3 py-3" data-testid="code-view">
        {tokens ? tokens.map((t, i) => (t.cls ? <span key={i} className={t.cls}>{t.text}</span> : t.text)) : shown}
      </pre>
    </div>
  );
}
