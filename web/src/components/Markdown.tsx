import type { ReactNode } from "react";

/** Minimal, XSS-safe Markdown (bold, italics, inline code, bullets, headings). Builds React nodes — no innerHTML. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++} className="font-semibold text-fg">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="rounded bg-surface-3 px-1 font-mono text-[12px]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k++} className="text-muted">{t.slice(1, -1)}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`ul${blocks.length}`} className="my-1.5 list-disc space-y-1 pl-5">{list}</ul>);
    list = [];
  };
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (/^[-*] /.test(t)) list.push(<li key={i}>{inline(t.slice(2))}</li>);
    else {
      flush();
      if (!t) return;
      if (t.startsWith("#")) blocks.push(<h4 key={i} className="mt-2 font-semibold text-fg">{inline(t.replace(/^#+\s*/, ""))}</h4>);
      else blocks.push(<p key={i} className="my-1.5">{inline(t)}</p>);
    }
  });
  flush();
  return <div className="text-[13.5px] leading-relaxed text-muted">{blocks}</div>;
}
