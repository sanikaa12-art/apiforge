export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function formatPercent(v: number | null | undefined, digits = 0): string {
  return v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Pretty-prints JSON; returns the input unchanged if it isn't JSON. */
export function prettyJson(text: string): { text: string; isJson: boolean } {
  try {
    return { text: JSON.stringify(JSON.parse(text), null, 2), isJson: true };
  } catch {
    return { text, isJson: false };
  }
}

export function statusTone(status: number | null | undefined): "ok" | "warn" | "bad" | "muted" {
  if (status == null) return "bad";
  if (status < 300) return "ok";
  if (status < 400) return "warn";
  return "bad";
}

/** Splits a URL's query string into key/value rows (used when the user pastes a URL). */
export function parseQuery(url: string): { base: string; params: { key: string; value: string; enabled: boolean }[] } {
  const i = url.indexOf("?");
  if (i === -1) return { base: url, params: [] };
  const params = url
    .slice(i + 1)
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const [k, ...v] = pair.split("=");
      const dec = (s: string) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, " "));
        } catch {
          return s;
        }
      };
      return { key: dec(k ?? ""), value: dec(v.join("=")), enabled: true };
    });
  return { base: url.slice(0, i), params };
}
