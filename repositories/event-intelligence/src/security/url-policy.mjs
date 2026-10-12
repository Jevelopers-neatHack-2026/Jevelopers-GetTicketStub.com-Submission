import { isIP } from "node:net";
import { RetrievalError } from "./errors.mjs";

const DENIED_SUFFIXES = Object.freeze([
  ".localhost", ".local", ".internal", ".test", ".invalid", ".example", ".onion",
]);
const SENSITIVE_QUERY_KEY = /(?:token|key|auth|code|signature|sig|secret|session|password|credential|invite|ticket|admission)/i;

function repeatedlyDecode(value) {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    let decoded;
    try { decoded = decodeURIComponent(current.replaceAll('+', '%20')); }
    catch { return null; }
    if (decoded === current) return current;
    current = decoded;
  }
  try {
    return decodeURIComponent(current.replaceAll('+', '%20')) === current ? current : null;
  } catch {
    return null;
  }
}

/** Reject credential-like query and fragment names before a URL is persisted or fetched. */
export function hasSensitiveUrlMaterial(url) {
  if (!(url instanceof URL)) return true;
  for (const key of url.searchParams.keys()) {
    const decoded = repeatedlyDecode(key);
    if (decoded === null || SENSITIVE_QUERY_KEY.test(decoded)) return true;
  }
  const fragment = url.hash.slice(1);
  if (fragment === '') return false;
  const decodedFragment = repeatedlyDecode(fragment);
  if (decodedFragment === null || SENSITIVE_QUERY_KEY.test(decodedFragment)) return true;
  for (const component of decodedFragment.split(/[&;]/)) {
    const key = repeatedlyDecode(component.split('=', 1)[0]);
    if (key === null || SENSITIVE_QUERY_KEY.test(key)) return true;
  }
  return false;
}

function ipv4Number(address) {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part))) return null;
  const bytes = parts.map(Number);
  if (bytes.some((part) => part > 255)) return null;
  return bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
}

function ipv6Number(address) {
  let value = address.toLowerCase();
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const v4 = ipv4Number(value.slice(lastColon + 1));
    if (v4 === null) return null;
    const high = Number((v4 >> 16n) & 0xffffn).toString(16);
    const low = Number(v4 & 0xffffn).toString(16);
    value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === "" ? [] : halves[0].split(":");
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1].split(":");
  const gap = 8 - left.length - right.length;
  if ((halves.length === 1 && gap !== 0) || (halves.length === 2 && gap < 1)) return null;
  const words = [...left, ...Array(gap).fill("0"), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.reduce((number, word) => (number << 16n) | BigInt(`0x${word}`), 0n);
}

function inCidr(value, prefix, bits) {
  const shift = BigInt(bits - prefix);
  return (value >> shift) === 0n;
}

function inNetwork(value, network, prefix, bits) {
  const shift = BigInt(bits - prefix);
  return (value >> shift) === (network >> shift);
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    if (value === null) return false;
    const blocked = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
      ["192.0.2.0", 24], ["192.31.196.0", 24], ["192.52.193.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["192.175.48.0", 24],
      ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return !blocked.some(([network, prefix]) => inCidr(value ^ ipv4Number(network), prefix, 32));
  }
  if (family === 6) {
    const value = ipv6Number(address);
    if (value === null) return false;
    // Only global-unicast space is eligible; known special-use prefixes are denied below.
    return inNetwork(value, ipv6Number("2000::"), 3, 128)
      && !inNetwork(value, ipv6Number("2001:db8::"), 32, 128)
      && !inNetwork(value, ipv6Number("2001::"), 23, 128)
      && !inNetwork(value, ipv6Number("2002::"), 16, 128)
      && !inNetwork(value, ipv6Number("2620:4f:8000::"), 48, 128)
      && !inNetwork(value, ipv6Number("3fff::"), 20, 128);
  }
  return false;
}

function addressIdentity(address) {
  const family = isIP(address);
  if (family === 4) return { family: 4, value: ipv4Number(address) };
  if (family === 6) {
    const value = ipv6Number(address);
    const mappedPrefix = ipv6Number("::ffff:0:0");
    if (value !== null && inNetwork(value, mappedPrefix, 96, 128)) return { family: 4, value: value & 0xffffffffn };
    return value === null ? null : { family: 6, value };
  }
  return null;
}

export function sameAddress(left, right) {
  const a = addressIdentity(left);
  const b = addressIdentity(right);
  return a !== null && b !== null && a.family === b.family && a.value === b.value;
}

function splitRawAuthority(raw) {
  const authorityStart = raw.indexOf("//") + 2;
  const authorityEnd = raw.slice(authorityStart).search(/[/?#]/);
  const authority = raw.slice(authorityStart, authorityEnd < 0 ? undefined : authorityStart + authorityEnd);
  if (!authority || /[\u0000-\u0020\u007f\\%@]/.test(authority)) throw new RetrievalError("POLICY_DENIED");
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end < 0) throw new RetrievalError("POLICY_DENIED");
    const host = authority.slice(1, end);
    const tail = authority.slice(end + 1);
    if (tail !== "" && !tail.startsWith(":")) throw new RetrievalError("POLICY_DENIED");
    return { rawHost: host, rawPort: tail === "" ? undefined : tail.slice(1), bracketed: true };
  }
  const colons = [...authority].filter((char) => char === ":").length;
  if (colons > 1) throw new RetrievalError("POLICY_DENIED");
  const split = authority.lastIndexOf(":");
  return split < 0
    ? { rawHost: authority, rawPort: undefined, bracketed: false }
    : { rawHost: authority.slice(0, split), rawPort: authority.slice(split + 1), bracketed: false };
}

export function validateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host.endsWith(".") || /[%\u0000-\u0020\u007f\\]/.test(host)) {
    throw new RetrievalError("POLICY_DENIED");
  }
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new RetrievalError("POLICY_DENIED");
    return host;
  }
  if (!/^[a-z0-9.-]+$/.test(host) || host.length > 253 || !host.includes(".")) throw new RetrievalError("POLICY_DENIED");
  if (host.split(".").some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new RetrievalError("POLICY_DENIED");
  }
  if (DENIED_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))) {
    throw new RetrievalError("POLICY_DENIED");
  }
  if (/^[0-9.]+$/.test(host)) throw new RetrievalError("POLICY_DENIED");
  return host;
}

export function parseAndValidateUrl(input) {
  if (typeof input !== "string" || input.length === 0 || input.length > 8_192 || /[\u0000-\u0020\u007f\\]/.test(input)) {
    throw new RetrievalError("POLICY_DENIED");
  }
  if (!/^https?:\/\//i.test(input)) throw new RetrievalError("POLICY_DENIED");
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new RetrievalError("POLICY_DENIED");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new RetrievalError("POLICY_DENIED");
  if (parsed.username || parsed.password) throw new RetrievalError("POLICY_DENIED");
  const { rawHost, rawPort, bracketed } = splitRawAuthority(input);
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (bracketed !== (isIP(host) === 6)) throw new RetrievalError("POLICY_DENIED");
  if (!bracketed && isIP(host) === 4 && rawHost.toLowerCase() !== host) throw new RetrievalError("POLICY_DENIED");
  if (rawPort !== undefined) {
    if (rawPort === "") throw new RetrievalError("POLICY_DENIED");
    const expected = parsed.protocol === "https:" ? "443" : "80";
    if (rawPort !== expected) throw new RetrievalError("POLICY_DENIED");
  }
  const validatedHost = validateHostname(host);
  const expectedPort = parsed.protocol === "https:" ? "443" : "80";
  if (parsed.port && parsed.port !== expectedPort) throw new RetrievalError("POLICY_DENIED");
  parsed.hash = "";
  return Object.freeze({ url: parsed, hostname: validatedHost, port: Number(expectedPort) });
}
