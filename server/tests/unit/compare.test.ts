import { describe, expect, it } from "vitest";
import { compareRuns } from "../../src/modules/testing/compare.js";

const r = (id: string, passed: boolean, durationMs = 100) => ({ testCaseId: id, name: `Test ${id}`, passed, status: passed ? 200 : 500, durationMs });

describe("compareRuns", () => {
  it("classifies every change and flags regressions", () => {
    const base = [r("a", true), r("b", false), r("c", true, 100), r("d", false), r("gone", true)];
    const current = [r("a", false), r("b", true), r("c", true, 160), r("d", false), r("new", true)];
    const cmp = compareRuns(base, current);
    expect(cmp.counts).toEqual({ newFailure: 1, stillFailing: 1, fixed: 1, added: 1, removed: 1, stillPassing: 1 });
    expect(cmp.hasRegressions).toBe(true);
    expect(cmp.entries[0]!.change).toBe("newFailure"); // regressions sorted first
    expect(cmp.entries.find((e) => e.key === "c")!.durationDeltaMs).toBe(60);
  });
  it("reports no regressions when nothing broke", () => {
    expect(compareRuns([r("a", true)], [r("a", true)]).hasRegressions).toBe(false);
  });
});
