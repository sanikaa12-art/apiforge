import { describe, expect, it } from "vitest";
import { assertSafeUrl, isBlockedHostname, isBlockedIp } from "../../src/modules/executor/ssrf.js";

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1",
    "127.10.20.30",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // AWS/GCP/Azure metadata
    "100.100.100.200", // Alibaba metadata (CGNAT range)
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00:ec2::254", // AWS IPv6 metadata
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1", // NAT64 embedding 127.0.0.1
    "2002:7f00:1::", // 6to4 embedding 127.0.0.1
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "104.16.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows public %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("isBlockedHostname", () => {
  it.each(["localhost", "LOCALHOST.", "api.localhost", "metadata.google.internal", "printer.local", "db.svc.cluster.local"])("blocks %s", (h) =>
    expect(isBlockedHostname(h)).toBe(true),
  );
  it("allows normal hosts", () => expect(isBlockedHostname("api.github.com")).toBe(false));
});

describe("assertSafeUrl", () => {
  const policy = (addresses: string[], allowlist: string[] = []) => ({
    allowlist,
    resolver: async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
  });

  it("accepts a public host", async () => {
    await expect(assertSafeUrl("https://api.example.com/v1", policy(["93.184.216.34"]))).resolves.toBeInstanceOf(URL);
  });
  it("rejects non-http protocols", async () => {
    for (const u of ["file:///etc/passwd", "gopher://x", "ftp://example.com", "javascript:alert(1)"]) {
      await expect(assertSafeUrl(u, policy(["93.184.216.34"]))).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
    }
  });
  it("rejects hosts that resolve to private addresses (DNS rebinding style)", async () => {
    await expect(assertSafeUrl("http://evil.example.com", policy(["93.184.216.34", "10.0.0.5"]))).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
  it("rejects alternative IP encodings normalised by the URL parser", async () => {
    for (const u of ["http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://[::ffff:7f00:1]/", "http://127.1/"]) {
      await expect(assertSafeUrl(u, policy([]))).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
    }
  });
  it("lets explicitly allowlisted hosts through (dev only)", async () => {
    await expect(assertSafeUrl("http://localhost:3000", policy([], ["localhost"]))).resolves.toBeInstanceOf(URL);
  });
  it("rejects invalid URLs with a friendly error", async () => {
    await expect(assertSafeUrl("not a url", policy([]))).rejects.toMatchObject({ code: "INVALID_URL" });
  });
});
