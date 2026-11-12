import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import type { EndpointDescriptor } from "../openapi/parser.js";
import { claudeDisabledReason, claudeEnabled, claudeGenerate, claudeSummarize, noteClaudeError, type FailureForSummary } from "./claude.js";
import { heuristicForEndpoint } from "./heuristic.js";
import { heuristicSummary } from "./summary.js";
import type { GenerationOptions, GenerationResult } from "./types.js";

export function aiStatus() {
  if (claudeEnabled()) return { provider: "claude" as const, model: env.AI_MODEL };
  const reason = claudeDisabledReason();
  const notice = reason
    ? `Claude is unavailable (${reason}); the built-in generator is active.`
    : env.AI_PROVIDER === "claude"
      ? "AI_PROVIDER=claude but ANTHROPIC_API_KEY is not set; the built-in generator is active."
      : "Runs locally — no API key or paid service needed.";
  return { provider: "heuristic" as const, model: null, notice };
}

export async function generateTests(endpoints: EndpointDescriptor[], opts: GenerationOptions, inferred = false): Promise<GenerationResult> {
  if (claudeEnabled()) {
    try {
      const r = await claudeGenerate(endpoints, opts);
      if (r.tests.length) return { provider: "claude", model: env.AI_MODEL, tests: r.tests, validationGaps: r.gaps };
    } catch (err) {
      noteClaudeError(err);
      logger.warn({ err: (err as Error)?.message }, "Claude generation failed; falling back to heuristic generator");
      const fallback = runHeuristic(endpoints, opts, inferred);
      return { ...fallback, notice: "AI service was unavailable, so the built-in generator was used instead." };
    }
  }
  return runHeuristic(endpoints, opts, inferred);
}

function runHeuristic(endpoints: EndpointDescriptor[], opts: GenerationOptions, inferred: boolean): GenerationResult {
  const tests = [];
  const gaps = [];
  for (const ep of endpoints) {
    const r = heuristicForEndpoint(ep, opts, inferred);
    tests.push(...r.tests);
    gaps.push(...r.gaps);
  }
  return { provider: "heuristic", tests, validationGaps: gaps };
}

export async function summarizeFailures(suiteName: string, stats: { total: number; passed: number; failed: number }, failures: FailureForSummary[]): Promise<{ text: string; source: "claude" | "heuristic" }> {
  if (stats.failed > 0 && claudeEnabled()) {
    try {
      return { text: await claudeSummarize(suiteName, stats, failures), source: "claude" };
    } catch (err) {
      noteClaudeError(err);
      logger.warn({ err: (err as Error)?.message }, "Claude summary failed; using heuristic summary");
    }
  }
  return { text: heuristicSummary(suiteName, stats, failures), source: "heuristic" };
}
