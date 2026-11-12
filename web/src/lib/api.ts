/**
 * Fetch wrapper. The short-lived access token lives only in memory (never in
 * localStorage, so XSS can't steal a long-lived credential). When a request
 * gets 401, we call /auth/refresh once — the httpOnly refresh cookie is sent
 * automatically — and retry.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const setSessionExpiredHandler = (fn: () => void) => {
  onSessionExpired = fn;
};

export async function refreshSession(): Promise<{ accessToken: string; user: import("./types").User } | null> {
  const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" });
  if (!res.ok) return null;
  const data = await res.json();
  accessToken = data.accessToken;
  return data;
}

async function tryRefresh(): Promise<boolean> {
  refreshing ??= refreshSession()
    .then((r) => !!r)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Options = Omit<RequestInit, "body"> & { body?: unknown; raw?: boolean };

export async function api<T = unknown>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const headers = new Headers(opts.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...opts, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the APIForge server. Is the backend running?");
  }

  if (res.status === 401 && !retried && !path.startsWith("/auth/")) {
    if (await tryRefresh()) return api<T>(path, opts, true);
    onSessionExpired?.();
  }
  if (res.status === 204) return undefined as T;
  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, "HTTP_ERROR", `Request failed (${res.status})`);
    return (await res.text()) as T;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "HTTP_ERROR", err.message ?? `Request failed (${res.status})`, err.details);
  }
  return data as T;
}

export const http = {
  get: <T>(p: string) => api<T>(p),
  post: <T>(p: string, body?: unknown) => api<T>(p, { method: "POST", body: body ?? {} }),
  patch: <T>(p: string, body: unknown) => api<T>(p, { method: "PATCH", body }),
  put: <T>(p: string, body: unknown) => api<T>(p, { method: "PUT", body }),
  del: <T = void>(p: string) => api<T>(p, { method: "DELETE" }),
};
