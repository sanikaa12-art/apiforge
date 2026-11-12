import { useMemo, useState } from "react";
import { formatMs } from "../lib/format";

/**
 * Hand-built SVG charts (no chart library). Specs: bars ≤ 24px with a 4px
 * rounded top and a 2px surface gap between stacked segments, 2px lines with a
 * ~10% area wash, hairline recessive gridlines, hover tooltips on every mark.
 */
const W = 640;
const H = 200;
const PAD = { l: 36, r: 8, t: 10, b: 22 };

function niceMax(v: number) {
  if (v <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function Tooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line-strong bg-surface-3 px-2.5 py-1.5 text-xs shadow-lg shadow-black/40" style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, marginTop: -8 }}>
      {children}
    </div>
  );
}

function Grid({ max, fmt }: { max: number; fmt: (v: number) => string }) {
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
          <text x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--color-faint)">
            {fmt(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

export function RequestsChart({ data }: { data: { date: string; requests: number; failed: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.requests), 1));
  const innerW = W - PAD.l - PAD.r;
  const band = innerW / data.length;
  const barW = Math.min(24, band * 0.6);
  const yScale = (v: number) => ((H - PAD.t - PAD.b) * v) / max;
  const base = H - PAD.b;
  const every = Math.ceil(data.length / 7);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Requests per day, successful and failed">
        <Grid max={max} fmt={(v) => String(Math.round(v))} />
        {data.map((d, i) => {
          const x = PAD.l + i * band + (band - barW) / 2;
          const okH = yScale(d.requests - d.failed);
          const badH = yScale(d.failed);
          const gap = okH > 0 && badH > 0 ? 2 : 0;
          const r = Math.min(4, barW / 2);
          // top segment gets the rounded data-end
          const topY = base - okH - badH;
          const roundedTop = (y: number, h: number, w: number) => `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
          return (
            <g key={d.date} opacity={hover === null || hover === i ? 1 : 0.45}>
              {okH > 0 && (badH > 0 ? <rect x={x} y={base - okH} width={barW} height={okH} fill="var(--color-accent)" /> : <path d={roundedTop(base - okH, okH, barW)} fill="var(--color-accent)" />)}
              {badH > 0 && <path d={roundedTop(topY, Math.max(badH - gap, 1), barW)} fill="var(--color-bad)" />}
              {i % every === 0 && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-faint)">
                  {dayLabel(d.date)}
                </text>
              )}
              <rect x={PAD.l + i * band} y={PAD.t} width={band} height={H - PAD.t - PAD.b} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <Tooltip x={PAD.l + hover * band + band / 2} y={base - yScale(data[hover].requests)}>
          <div className="font-medium">{dayLabel(data[hover].date)}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-muted"><span className="size-2 rounded-sm bg-accent" />Successful <span className="ml-auto pl-3 text-fg">{data[hover].requests - data[hover].failed}</span></div>
          <div className="flex items-center gap-1.5 text-muted"><span className="size-2 rounded-sm bg-bad" />Failed <span className="ml-auto pl-3 text-fg">{data[hover].failed}</span></div>
        </Tooltip>
      )}
      <div className="mt-2 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent" />Successful</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-bad" />Failed (4xx/5xx or network)</span>
      </div>
    </div>
  );
}

export function LatencyChart({ data }: { data: { date: string; avgMs: number | null }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.avgMs ?? 0), 1));
  const innerW = W - PAD.l - PAD.r;
  const step = data.length > 1 ? innerW / (data.length - 1) : innerW;
  const x = (i: number) => PAD.l + i * step;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const pts = useMemo(() => data.map((d, i) => (d.avgMs == null ? null : ([x(i), y(d.avgMs)] as const))), [data, max]); // eslint-disable-line react-hooks/exhaustive-deps
  const segments: (readonly [number, number])[][] = [];
  let cur: (readonly [number, number])[] = [];
  for (const p of pts) {
    if (p) cur.push(p);
    else if (cur.length) {
      segments.push(cur);
      cur = [];
    }
  }
  if (cur.length) segments.push(cur);
  const every = Math.ceil(data.length / 7);
  const last = [...pts].reverse().find(Boolean);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Average response time per day" onMouseLeave={() => setHover(null)}>
        <Grid max={max} fmt={(v) => (v >= 1000 ? `${v / 1000}s` : `${Math.round(v)}`)} />
        {segments.map((s, k) => (
          <g key={k}>
            <path d={`M${s[0]![0]},${H - PAD.b} ${s.map(([a, b]) => `L${a},${b}`).join(" ")} L${s.at(-1)![0]},${H - PAD.b} Z`} fill="var(--color-info)" opacity={0.1} />
            <path d={s.map(([a, b], i) => `${i ? "L" : "M"}${a},${b}`).join(" ")} fill="none" stroke="var(--color-info)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {data.map((d, i) =>
          i % every === 0 ? (
            <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-faint)">
              {dayLabel(d.date)}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-line-strong)" strokeWidth={1} />
            {pts[hover] && <circle cx={pts[hover]![0]} cy={pts[hover]![1]} r={4} fill="var(--color-info)" stroke="var(--color-surface)" strokeWidth={2} />}
          </>
        )}
        {last && hover === null && <circle cx={last[0]} cy={last[1]} r={4} fill="var(--color-info)" stroke="var(--color-surface)" strokeWidth={2} />}
        {data.map((d, i) => (
          <rect key={d.date} x={x(i) - step / 2} y={PAD.t} width={step} height={H - PAD.t - PAD.b} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && data[hover] && (
        <Tooltip x={x(hover)} y={pts[hover]?.[1] ?? H / 2}>
          <div className="font-medium">{dayLabel(data[hover].date)}</div>
          <div className="text-muted">
            Avg response <span className="text-fg">{formatMs(data[hover].avgMs)}</span>
          </div>
        </Tooltip>
      )}
    </div>
  );
}
