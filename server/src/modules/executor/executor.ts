import http from "node:http";
import { performance } from "node:perf_hooks";
import { Agent, request, errors as undiciErrors } from "undici";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { HttpMethodName, KeyValue } from "../../lib/types.js";
import { assertSafeUrl, createSafeLookup, SsrfError, type SsrfPolicy } from "./ssrf.js";

export interface ExecuteInput {
  method: HttpMethodName;
  url: string;
  headers?: KeyValue[];
  queryParams?: KeyValue[];
  body?: string | null;
  followRedirects?: boolean;
}

export interface ExecuteResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  sizeBytes: number;
  durationMs: number;
  truncated: boolean;
  finalUrl: string;
  redirects: string[];
  requestHeaders: Record<string, string>;
}

// Headers the user must not control: they are computed by the HTTP client or
// would let a request smuggle/upgrade the connection.
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding", "keep-alive", "upgrade", "expect", "proxy-connection", "te", "trailer"]);
const CROSS_ORIGIN_STRIP = new Set(["authorization", "cookie", "proxy-authorization"]);

export function buildUrl(baseUrl: string, query: KeyValue[] = []): string {
  const enabled = query.filter((q) => q.enabled && q.key);
  if (enabled.length === 0) return baseUrl;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AppError(400, "INVALID_URL", "The URL is not valid. Include the protocol, e.g. https://api.example.com");
  }
  for (const q of enabled) url.searchParams.append(q.key, q.value);
  return url.toString();
}

export function buildHeaders(list: KeyValue[] = [], hasBody: boolean, body?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of list) {
    if (!h.enabled || !h.key) continue;
    const name = h.key.trim().toLowerCase();
    if (FORBIDDEN_HEADERS.has(name)) continue;
    if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(name)) throw new AppError(400, "INVALID_HEADER", `Invalid header name "${h.key}"`);
    if (/[\r\n]/.test(h.value)) throw new AppError(400, "INVALID_HEADER", `Header "${h.key}" contains a line break`);
    out[name] = h.value;
  }
  if (hasBody && !out["content-type"] && body) {
    const trimmed = body.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) out["content-type"] = "application/json";
  }
  out["user-agent"] ??= "APIForge/1.0";
  out["accept"] ??= "*/*";
  return out;
}

export class RequestExecutor {
  private agent: Agent;

  constructor(
    private readonly policy: SsrfPolicy = { allowlist: env.SSRF_ALLOWLIST },
    private readonly limits = { timeoutMs: env.REQUEST_TIMEOUT_MS, maxBytes: env.MAX_RESPONSE_BYTES, maxRedirects: env.MAX_REDIRECTS },
  ) {
    this.agent = new Agent({
      connect: { lookup: createSafeLookup(policy) as never, timeout: Math.min(10_000, limits.timeoutMs) },
      headersTimeout: limits.timeoutMs,
      bodyTimeout: limits.timeoutMs,
      connections: 32,
    });
  }

  async execute(input: ExecuteInput): Promise<ExecuteResult> {
    let method: string = input.method;
    let url = buildUrl(input.url, input.queryParams);
    const hasBody = !!input.body && !["GET", "HEAD"].includes(method);
    let body: string | undefined = hasBody ? (input.body ?? undefined) : undefined;
    let headers = buildHeaders(input.headers, hasBody, body);
    const requestHeaders = { ...headers };
    const redirects: string[] = [];
    const follow = input.followRedirects !== false;
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.limits.timeoutMs);

    try {
      for (let hop = 0; ; hop++) {
        const target = await assertSafeUrl(url, this.policy);
        const res = await request(target, {
          method: method as never,
          headers,
          body,
          dispatcher: this.agent,
          signal: controller.signal,
        });

        const location = res.headers["location"];
        if (follow && [301, 302, 303, 307, 308].includes(res.statusCode) && typeof location === "string") {
          await res.body.dump();
          if (hop >= this.limits.maxRedirects) throw new AppError(502, "TOO_MANY_REDIRECTS", `Stopped after ${this.limits.maxRedirects} redirects`);
          const next = new URL(location, target);
          // Never forward credentials to a different origin.
          if (next.origin !== target.origin) {
            headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !CROSS_ORIGIN_STRIP.has(k)));
          }
          if (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === "POST")) {
            method = "GET";
            body = undefined;
            delete headers["content-type"];
          }
          url = next.toString();
          redirects.push(url);
          continue; // next loop iteration re-validates the new destination
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        for await (const chunk of res.body) {
          const buf = chunk as Buffer;
          if (size + buf.length > this.limits.maxBytes) {
            chunks.push(buf.subarray(0, this.limits.maxBytes - size));
            size = this.limits.maxBytes;
            truncated = true;
            res.body.destroy();
            break;
          }
          chunks.push(buf);
          size += buf.length;
        }
        const durationMs = Math.round(performance.now() - started);
        const responseHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) responseHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v);
        }
        return {
          status: res.statusCode,
          statusText: http.STATUS_CODES[res.statusCode] ?? "",
          headers: responseHeaders,
          body: Buffer.concat(chunks).toString("utf8"),
          sizeBytes: size,
          durationMs,
          truncated,
          finalUrl: url,
          redirects,
          requestHeaders,
        };
      }
    } catch (err) {
      throw translateError(err, this.limits.timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  async close() {
    await this.agent.close();
  }
}

function translateError(err: unknown, timeoutMs: number): AppError {
  if (err instanceof AppError) return err;
  const cause = (err as { cause?: unknown })?.cause;
  if (cause instanceof SsrfError) return cause;
  if (err instanceof undiciErrors.HeadersTimeoutError || err instanceof undiciErrors.BodyTimeoutError || (err as Error)?.name === "AbortError" || err instanceof undiciErrors.RequestAbortedError) {
    return new AppError(504, "UPSTREAM_TIMEOUT", `The request timed out after ${timeoutMs} ms`);
  }
  if (err instanceof undiciErrors.ConnectTimeoutError) return new AppError(504, "UPSTREAM_TIMEOUT", "Timed out while connecting to the host");
  const code = (err as NodeJS.ErrnoException)?.code ?? (cause as NodeJS.ErrnoException)?.code;
  const messages: Record<string, string> = {
    ENOTFOUND: "Could not resolve the host name",
    ECONNREFUSED: "The server refused the connection",
    ECONNRESET: "The connection was reset by the server",
    EHOSTUNREACH: "The host is unreachable",
    CERT_HAS_EXPIRED: "The server's TLS certificate has expired",
    DEPTH_ZERO_SELF_SIGNED_CERT: "The server uses a self-signed TLS certificate",
    UND_ERR_SOCKET: "The connection closed unexpectedly",
  };
  if (code && messages[code]) return new AppError(502, "UPSTREAM_ERROR", messages[code]!);
  return new AppError(502, "UPSTREAM_ERROR", `Request failed: ${(err as Error)?.message ?? "unknown error"}`);
}

let shared: RequestExecutor | undefined;
export const getExecutor = () => (shared ??= new RequestExecutor());
/** Test hook: swap the process-wide executor (e.g. to allowlist a local test server). */
export const setExecutor = (e: RequestExecutor) => {
  shared = e;
};
