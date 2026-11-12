/**
 * SSRF (Server-Side Request Forgery) protection.
 *
 * APIForge sends HTTP requests *from our server* on behalf of users. Without
 * protection, a user could ask the server to call http://169.254.169.254 (cloud
 * metadata, which leaks credentials), http://localhost:5432, or machines on the
 * private network. Defences, in order:
 *
 *  1. Only http/https URLs, no blocked hostnames (localhost, metadata names…).
 *  2. Every IP is classified with ipaddr.js; only public "unicast" addresses pass.
 *     That excludes loopback, private (RFC1918), link-local (incl. 169.254.169.254),
 *     carrier-grade NAT (incl. 100.100.100.200), unique-local IPv6, multicast,
 *     reserved ranges, and IPv6 forms that embed IPv4 (mapped, NAT64, 6to4, Teredo).
 *  3. DNS is validated twice: once up front (for a clear error) and again inside
 *     the socket's `lookup` hook, so the IP we connect to is exactly the IP we
 *     checked. That closes the DNS-rebinding gap between "check" and "connect".
 *  4. Redirects are followed manually and each hop goes through 1–3 again.
 */
import dns from "node:dns";
import net from "node:net";
import ipaddr from "ipaddr.js";
import { AppError } from "../../lib/errors.js";

export class SsrfError extends AppError {
  constructor(message: string) {
    super(400, "SSRF_BLOCKED", message);
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
  "kubernetes.default",
  "kubernetes.default.svc",
]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".svc.cluster.local", ".home.arpa"];

export function normaliseHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

/** True if the IP must not be contacted. Unparseable input is treated as blocked. */
export function isBlockedIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return true;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  return addr.range() !== "unicast";
}

export function isBlockedHostname(hostname: string): boolean {
  const h = normaliseHostname(hostname);
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  return BLOCKED_SUFFIXES.some((s) => h.endsWith(s));
}

export interface SsrfPolicy {
  /** Hostnames allowed to resolve to private addresses (development only). */
  allowlist: string[];
  resolver?: (hostname: string) => Promise<{ address: string; family: number }[]>;
}

const defaultResolver = (hostname: string) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/** Validates a URL before any connection is attempted. Throws SsrfError. */
export async function assertSafeUrl(rawUrl: string, policy: SsrfPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(400, "INVALID_URL", "The URL is not valid. Include the protocol, e.g. https://api.example.com");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Protocol "${url.protocol}" is not allowed. Use http or https.`);
  }
  const host = normaliseHostname(url.hostname);
  if (!host) throw new AppError(400, "INVALID_URL", "The URL has no host");
  if (policy.allowlist.includes(host)) return url;

  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError(`Requests to private, loopback or reserved addresses (${host}) are blocked.`);
    return url;
  }
  if (isBlockedHostname(host)) throw new SsrfError(`Requests to internal hostnames (${host}) are blocked.`);

  let addresses: { address: string }[];
  try {
    addresses = await (policy.resolver ?? defaultResolver)(host);
  } catch {
    throw new AppError(502, "DNS_LOOKUP_FAILED", `Could not resolve host "${host}"`);
  }
  if (addresses.length === 0) throw new AppError(502, "DNS_LOOKUP_FAILED", `Could not resolve host "${host}"`);
  const bad = addresses.find((a) => isBlockedIp(a.address));
  if (bad) throw new SsrfError(`"${host}" resolves to a private or reserved address (${bad.address}); the request was blocked.`);
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/**
 * A drop-in replacement for dns.lookup used by the HTTP agent at connect time.
 * Re-validates every resolved address, so a DNS answer that changed after
 * assertSafeUrl (DNS rebinding) is still caught before a socket opens.
 */
export function createSafeLookup(policy: SsrfPolicy) {
  return function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
    const host = normaliseHostname(hostname);
    dns.lookup(host, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as dns.LookupAddress[];
      if (!policy.allowlist.includes(host)) {
        if (isBlockedHostname(host)) return callback(new SsrfError(`Requests to internal hostnames (${host}) are blocked.`), "", 0);
        const bad = list.find((a) => isBlockedIp(a.address));
        if (bad) return callback(new SsrfError(`"${host}" resolved to a blocked address (${bad.address}) at connect time.`), "", 0);
      }
      if (options.all) return callback(null, list);
      const first = list[0];
      if (!first) return callback(Object.assign(new Error(`No addresses for ${host}`), { code: "ENOTFOUND" }), "", 0);
      callback(null, first.address, first.family);
    });
  };
}
