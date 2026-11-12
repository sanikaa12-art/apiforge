/**
 * Regression comparison between two runs of the same suite. Results are matched
 * by test case id (falling back to name for deleted cases).
 */
export interface ComparableResult {
  testCaseId: string | null;
  name: string;
  passed: boolean;
  status: number | null;
  durationMs: number | null;
}

export type ChangeKind = "newFailure" | "fixed" | "stillFailing" | "stillPassing" | "added" | "removed";

export interface ComparisonEntry {
  key: string;
  name: string;
  change: ChangeKind;
  base?: ComparableResult;
  current?: ComparableResult;
  durationDeltaMs: number | null;
}

export interface Comparison {
  entries: ComparisonEntry[];
  counts: Record<ChangeKind, number>;
  hasRegressions: boolean;
  avgDurationDeltaMs: number | null;
}

const keyOf = (r: ComparableResult) => r.testCaseId ?? `name:${r.name}`;

export function compareRuns(base: ComparableResult[], current: ComparableResult[]): Comparison {
  const baseMap = new Map(base.map((r) => [keyOf(r), r]));
  const currentMap = new Map(current.map((r) => [keyOf(r), r]));
  const entries: ComparisonEntry[] = [];

  for (const [key, cur] of currentMap) {
    const prev = baseMap.get(key);
    let change: ChangeKind;
    if (!prev) change = "added";
    else if (prev.passed && !cur.passed) change = "newFailure";
    else if (!prev.passed && cur.passed) change = "fixed";
    else if (!cur.passed) change = "stillFailing";
    else change = "stillPassing";
    const delta = prev?.durationMs != null && cur.durationMs != null ? cur.durationMs - prev.durationMs : null;
    entries.push({ key, name: cur.name, change, base: prev, current: cur, durationDeltaMs: delta });
  }
  for (const [key, prev] of baseMap) {
    if (!currentMap.has(key)) entries.push({ key, name: prev.name, change: "removed", base: prev, durationDeltaMs: null });
  }

  const order: ChangeKind[] = ["newFailure", "stillFailing", "fixed", "added", "removed", "stillPassing"];
  entries.sort((a, b) => order.indexOf(a.change) - order.indexOf(b.change) || a.name.localeCompare(b.name));
  const counts = Object.fromEntries(order.map((k) => [k, entries.filter((e) => e.change === k).length])) as Record<ChangeKind, number>;
  const deltas = entries.map((e) => e.durationDeltaMs).filter((d): d is number => d !== null);
  return {
    entries,
    counts,
    hasRegressions: counts.newFailure > 0,
    avgDurationDeltaMs: deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
  };
}
