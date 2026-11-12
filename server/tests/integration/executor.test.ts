import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser, startTargetServer } from "../helpers.js";
import { RequestExecutor, setExecutor } from "../../src/modules/executor/executor.js";

let target: Awaited<ReturnType<typeof startTargetServer>>;

beforeAll(async () => {
  target = await startTargetServer();
  // Only the local test server's IP is allowlisted; everything else stays protected.
  setExecutor(new RequestExecutor({ allowlist: ["127.0.0.1"] }, { timeoutMs: 1500, maxBytes: 1024 * 1024, maxRedirects: 3 }));
});
afterAll(async () => {
  await target.close();
  setExecutor(new RequestExecutor());
});

describe("request execution", () => {
  it("substitutes environment variables server-side and records redacted history", async () => {
    const u = await registerUser();
    const env = await u.post("/api/environments", {
      name: "Local",
      variables: [
        { key: "base", value: target.base },
        { key: "token", value: "tok_very_secret_123", isSecret: true },
      ],
    });
    const res = await u.post("/api/execute", {
      method: "POST",
      url: "{{base}}/echo",
      environmentId: env.body.id,
      headers: [
        { key: "Authorization", value: "Bearer {{token}}" },
        { key: "X-Disabled", value: "1", enabled: false },
      ],
      queryParams: [{ key: "q", value: "{{token}}" }],
      body: '{"hello":"world"}',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(200);
    expect(res.body.durationMs).toBeGreaterThanOrEqual(0);
    expect(res.body.sizeBytes).toBeGreaterThan(0);
    const echoed = JSON.parse(res.body.body);
    expect(echoed.headers["content-type"]).toBe("application/json"); // inferred from JSON body
    expect(echoed.headers["x-disabled"]).toBeUndefined();
    expect(echoed.body).toBe('{"hello":"world"}');
    // the target really received the secret, but the browser only sees a mask
    expect(res.body.body).not.toContain("tok_very_secret_123");
    expect(res.body.body).toContain("••••••");

    const hist = await u.get("/api/history");
    const entry = await u.get(`/api/history/${hist.body.items[0].id}`);
    expect(JSON.stringify(entry.body)).not.toContain("tok_very_secret_123");
    expect(entry.body.requestHeaders.authorization).toBe("[REDACTED]");
  });

  it("blocks private targets even when other hosts are allowlisted", async () => {
    const u = await registerUser();
    for (const url of ["http://10.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://localhost:5432", "http://[::1]:80/"]) {
      const res = await u.post("/api/execute", { method: "GET", url });
      expect(res.status, url).toBe(400);
      expect(res.body.error.code).toBe("SSRF_BLOCKED");
    }
    const failed = await u.get("/api/history?failedOnly=true");
    expect(failed.body.items.length).toBe(4);
  });

  it("re-validates redirect destinations", async () => {
    const u = await registerUser();
    const blocked = await u.post("/api/execute", { method: "GET", url: `${target.base}/redirect-internal` });
    expect(blocked.body.error.code).toBe("SSRF_BLOCKED");
    const ok = await u.post("/api/execute", { method: "GET", url: `${target.base}/redirect-ok` });
    expect(ok.body.status).toBe(200);
    expect(ok.body.redirects).toEqual([`${target.base}/posts/1`]);
  });

  it("caps response size and reports truncation", async () => {
    const u = await registerUser();
    const res = await u.post("/api/execute", { method: "GET", url: `${target.base}/big` });
    expect(res.body.truncated).toBe(true);
    expect(res.body.sizeBytes).toBe(1024 * 1024);
  });

  it("times out slow upstreams with a clear error", async () => {
    const u = await registerUser();
    target.state.slowMs = 2500;
    const res = await u.post("/api/execute", { method: "GET", url: `${target.base}/posts` });
    target.state.slowMs = 0;
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe("UPSTREAM_TIMEOUT");
  });

  it("rejects header injection and reports unresolved variables", async () => {
    const u = await registerUser();
    const bad = await u.post("/api/execute", { method: "GET", url: `${target.base}/echo`, headers: [{ key: "X-A", value: "a\r\nX-Injected: 1" }] });
    expect(bad.status).toBe(400);
    const unresolved = await u.post("/api/execute", { method: "GET", url: `${target.base}/echo?x={{nope}}` });
    expect(unresolved.body.unresolvedVariables).toEqual(["nope"]);
  });
});
