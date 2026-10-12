import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// URL-first intake boundary. Numbers here are defensive app-side ceilings, not an agreed product
// contract: the research service (event-intelligence #9) still owns safe retrieval, and the support
// matrix / limits are pending GT-03.2 agreement. Everything is rejected before any dispatch.

export const INTAKE_LIMITS = {
  /** Characters in one pasted link. */
  urlChars: 2048,
  /** Characters in a search query. */
  queryChars: 200,
  /** Bytes in the whole request body. */
  bodyBytes: 8 * 1024,
  /** Redirect hops followed for one fetch, each re-validated. */
  redirects: 3,
  /** Bytes read from one fetched page. */
  pageBytes: 2_000_000,
} as const;

/** Request fields that mean an upload, extra sources or other input we do not support in v1. */
export const UNSUPPORTED_FIELDS = ["file", "files", "image", "images", "screenshot", "upload", "attachment", "email", "csv", "urls", "sources"] as const;

export type IntakeRejection = "url_too_long" | "url_malformed" | "unsupported_scheme" | "url_credentials" | "unsupported_port" | "blocked_destination";

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: IntakeRejection };

const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d+(?:[/?#]|$))/i; // "example.com:8080/x" is a host and port, not a scheme
const CONTROL = /[\x00-\x20\x7f-\x9f\s\\]/; // controls, any whitespace (incl. U+2028/9) and backslashes
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".home.arpa", ".corp", ".intranet", ".localdomain"];

function ipv4Blocked(a: number, b: number, c: number): boolean {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol, TEST-NET-1
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

/** True for private, loopback, link-local, multicast, documentation and otherwise reserved addresses. */
export function isBlockedIp(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return ipv4Blocked(a, b, c);
  }
  if (kind !== 6) return true; // not an address we can classify: fail closed
  const groups = expandIpv6(ip);
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (groups.every((g) => g === 0) || (groups.slice(0, 7).every((g) => g === 0) && g7 === 1)) return true; // :: and ::1
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::/96): judge the embedded IPv4.
  const embedded = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255] as const;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return ipv4Blocked(embedded[0], embedded[1], embedded[2]);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return ipv4Blocked(embedded[0], embedded[1], embedded[2]);
  if (g0 === 0x2002) return ipv4Blocked(g1 >> 8, g1 & 255, g2 >> 8); // 6to4 embeds an IPv4 too
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // deprecated site-local
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && (g1 === 0x0db8 || g1 === 0)) return true; // documentation, Teredo
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard-only
  return false;
}

function expandIpv6(ip: string): number[] | undefined {
  let text = ip;
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    if (p.some((n) => n > 255)) return undefined;
    text = text.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return undefined;
  const all = [...head, ...Array(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? all : undefined;
}

/** Hostname rules that need no DNS: IP literals, localhost-style names and single-label hosts. */
function hostBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, ""))) return isBlockedIp(host);
  if (host === "localhost" || !host.includes(".")) return true;
  return BLOCKED_SUFFIXES.some((s) => host.endsWith(s));
}

/** Does this text carry an explicit scheme, or credentials before an "@" in its authority? Those are never silently repaired. */
function hasScheme(raw: string): boolean {
  return SCHEME.test(raw) || raw.startsWith("//");
}

/**
 * Validates one pasted link without any network access. A bare "example.com/x" is read as https;
 * anything with another scheme, credentials, a non-standard port or a private/reserved host is rejected.
 */
export function parseIntakeUrl(input: string): UrlCheck {
  const raw = input.trim();
  if (raw.length > INTAKE_LIMITS.urlChars) return { ok: false, reason: "url_too_long" };
  if (!raw || CONTROL.test(raw)) return { ok: false, reason: "url_malformed" };
  if (hasScheme(raw) && !/^https?:\/\//i.test(raw)) return { ok: false, reason: "unsupported_scheme" };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: "url_malformed" };
  }
  return checkUrl(url);
}

/** The checks that apply to the first URL and to every redirect target alike. */
export function checkUrl(url: URL): UrlCheck {
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "unsupported_scheme" };
  if (url.username || url.password) return { ok: false, reason: "url_credentials" };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, reason: "unsupported_port" };
  if (!url.hostname || url.hostname.length > 253) return { ok: false, reason: "url_malformed" };
  if (hostBlocked(url.hostname)) return { ok: false, reason: "blocked_destination" };
  return { ok: true, url };
}

export type HostResolver = (hostname: string) => Promise<string[]>;

const systemResolver: HostResolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);
let resolver: HostResolver = systemResolver;

/** Offline tests install a resolver so no real DNS runs; pass nothing to restore the system one. */
export function setHostResolver(next?: HostResolver): void {
  resolver = next ?? systemResolver;
}

export class BlockedDestinationError extends Error {
  constructor(readonly reason: IntakeRejection | "too_many_redirects" | "dns_failed") {
    super(reason);
  }
}

/** Every address the name resolves to must be public; a name with no answers or any private answer is refused. */
async function assertPublicHost(url: URL): Promise<void> {
  if (isIP(url.hostname.replace(/^\[|\]$/g, ""))) return; // literals were judged by checkUrl
  let addresses: string[];
  try {
    addresses = await resolver(url.hostname);
  } catch {
    throw new BlockedDestinationError("dns_failed");
  }
  if (addresses.length === 0 || addresses.some(isBlockedIp)) throw new BlockedDestinationError("blocked_destination");
}

/**
 * The one outbound fetch for user-supplied links. Redirects are followed by hand so each hop is
 * re-validated (scheme, credentials, port, literal and resolved addresses) before it is requested.
 *
 * Known limit: the name is resolved here and again by fetch, so a hostile DNS server could answer
 * differently the second time (rebinding). Closing that needs a connection-level pin in the research
 * service (event-intelligence #9); this check narrows the window, it does not remove it.
 */
export async function fetchPublic(start: string | URL, init: RequestInit = {}): Promise<Response> {
  let url = typeof start === "string" ? new URL(start) : start;
  for (let hop = 0; ; hop++) {
    const check = checkUrl(url);
    if (!check.ok) throw new BlockedDestinationError(check.reason);
    await assertPublicHost(check.url);
    const res = await fetch(check.url.href, { ...init, redirect: "manual" });
    if (res.status < 300 || res.status >= 400 || res.status === 304) return res;
    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => undefined);
    if (!location) return res;
    if (hop >= INTAKE_LIMITS.redirects) throw new BlockedDestinationError("too_many_redirects");
    try {
      url = new URL(location, check.url);
    } catch {
      throw new BlockedDestinationError("url_malformed");
    }
  }
}

/** Reads at most `max` bytes of text, so a huge body cannot be pulled into memory first. */
export async function readCapped(res: Response, max: number = INTAKE_LIMITS.pageBytes): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(total, max));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, bytes.length - at);
    bytes.set(part, at);
    at += part.length;
  }
  return new TextDecoder().decode(bytes);
}
