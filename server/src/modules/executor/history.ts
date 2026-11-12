import { prisma } from "../../lib/prisma.js";
import { redactSecrets } from "../environments/variables.js";

const SENSITIVE_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "api-key", "x-auth-token"]);
const BODY_PREVIEW_LIMIT = 64 * 1024;

export function redactHeaders(headers: Record<string, string>, secrets: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? "[REDACTED]" : redactSecrets(v, secrets);
  return out;
}

export async function recordHistory(entry: {
  userId: string;
  method: string;
  url: string;
  environmentId?: string | null;
  secrets: string[];
  requestHeaders?: Record<string, string>;
  status?: number;
  durationMs?: number;
  sizeBytes?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  error?: string;
}) {
  return prisma.requestHistory.create({
    data: {
      userId: entry.userId,
      method: entry.method,
      url: redactSecrets(entry.url, entry.secrets),
      environmentId: entry.environmentId ?? null,
      status: entry.status ?? null,
      durationMs: entry.durationMs ?? null,
      sizeBytes: entry.sizeBytes ?? null,
      error: entry.error ?? null,
      requestHeaders: redactHeaders(entry.requestHeaders ?? {}, entry.secrets),
      responseHeaders: redactHeaders(entry.responseHeaders ?? {}, entry.secrets),
      responseBody: entry.responseBody ? redactSecrets(entry.responseBody.slice(0, BODY_PREVIEW_LIMIT), entry.secrets) : null,
    },
  });
}
