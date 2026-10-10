import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { performance } from "node:perf_hooks";
import { isPublicAddress, parseAndValidateUrl, sameAddress, validateHostname } from "./url-policy.mjs";
import { resolveSystemHost } from "./dns-resolver.mjs";
import { RetrievalError } from "./errors.mjs";
import { getTestSeam } from "./internal/test-seams.mjs";

export const DEFAULT_RUN_LIMITS = Object.freeze({
  requests: 30,
  redirectsPerFetch: 5,
  concurrentFetches: 4,
  connectMilliseconds: 10_000,
  totalMilliseconds: 30_000,
  compressedBytesPerRequest: 10 * 1024 * 1024,
  decodedTextBytesPerRequest: 20 * 1024 * 1024,
  decodedMediaBytesPerRequest: 10 * 1024 * 1024,
  decodedBytesPerRun: 100 * 1024 * 1024,
  imageMaximumDimension: 10_000,
  imageMaximumPixels: 20_000_000,
});

const ACCEPT = [
  "text/html", "application/xhtml+xml", "text/plain", "application/json",
  "application/ld+json", "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif",
].join(", ");
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const SUPPORTED_MIME = new Set(ACCEPT.split(", "));

function throwIfStopped(context) {
  if (context.deadlineReached) throw new RetrievalError("DEADLINE_EXCEEDED");
  if (context.signal.aborted) throw new RetrievalError("CANCELED");
  if (performance.now() >= context.deadline) throw new RetrievalError("DEADLINE_EXCEEDED");
}

function assertAllowedAddress(address, seam) {
  if (isPublicAddress(address)) return;
  if (seam?.isFixtureAddress?.(address) === true) return;
  throw new RetrievalError("POLICY_DENIED");
}

class FetchSemaphore {
  #active = 0;
  #queue = [];

  acquire(context) {
    throwIfStopped(context);
    if (this.#active < DEFAULT_RUN_LIMITS.concurrentFetches) {
      this.#active += 1;
      return Promise.resolve(() => this.#release());
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, context, timer: undefined, abort: undefined };
      const remove = () => {
        const index = this.#queue.indexOf(entry);
        if (index >= 0) this.#queue.splice(index, 1);
        clearTimeout(entry.timer);
        context.signal.removeEventListener("abort", entry.abort);
      };
      entry.abort = () => {
        remove();
        reject(context.deadlineReached ? new RetrievalError("DEADLINE_EXCEEDED") : new RetrievalError("CANCELED"));
      };
      entry.timer = setTimeout(() => {
        remove();
        reject(new RetrievalError("DEADLINE_EXCEEDED"));
      }, Math.max(1, context.deadline - performance.now()));
      context.signal.addEventListener("abort", entry.abort, { once: true });
      this.#queue.push(entry);
      try {
        throwIfStopped(context);
      } catch (error) {
        remove();
        reject(error);
      }
    });
  }

  #release() {
    while (this.#queue.length > 0) {
      const entry = this.#queue.shift();
      clearTimeout(entry.timer);
      entry.context.signal.removeEventListener("abort", entry.abort);
      try {
        throwIfStopped(entry.context);
        entry.resolve(() => this.#release());
        return;
      } catch (error) {
        entry.reject(error);
      }
    }
    this.#active -= 1;
  }
}

class PinnedAgentBase {
  constructor({ address, port, hostname, secure, signal, onDial, isAllowedPeer, ca }) {
    this.address = address;
    this.port = port;
    this.hostname = hostname;
    this.secure = secure;
    this.signal = signal;
    this.onDial = onDial;
    this.isAllowedPeer = isAllowedPeer;
    this.ca = ca;
  }

  createConnection(_options, callback) {
    const raw = net.connect({ host: this.address, port: this.port, family: net.isIP(this.address) });
    let finished = false;
    let timer;
    const finish = (error, socket) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      this.signal.removeEventListener("abort", onAbort);
      if (error) {
        raw.destroy();
        callback(error);
      } else {
        callback(null, socket);
      }
    };
    const onAbort = () => finish(new RetrievalError("CANCELED"));
    const checkPeer = (socket, record = false) => {
      const peer = socket.remoteAddress;
      if (!peer || !this.isAllowedPeer(peer)) throw new RetrievalError("POLICY_DENIED");
      if (record) this.onDial?.(Object.freeze({ peer, address: this.address, port: this.port }));
    };
    timer = setTimeout(() => finish(new RetrievalError("DEADLINE_EXCEEDED")), DEFAULT_RUN_LIMITS.connectMilliseconds);
    this.signal.addEventListener("abort", onAbort, { once: true });
    if (this.signal.aborted) return onAbort();
    raw.once("error", (error) => finish(new RetrievalError("TRANSPORT_FAILURE", { cause: error })));
    raw.once("connect", () => {
      try {
        checkPeer(raw, true);
        if (!this.secure) return finish(null, raw);
        const tlsSocket = tls.connect({
          socket: raw,
          servername: net.isIP(this.hostname) === 0 ? this.hostname : undefined,
          rejectUnauthorized: true,
          ca: this.ca,
          ALPNProtocols: ["http/1.1"],
          minVersion: "TLSv1.2",
          checkServerIdentity: (_serverName, certificate) => tls.checkServerIdentity(this.hostname, certificate),
        });
        tlsSocket.once("error", (error) => finish(new RetrievalError("TRANSPORT_FAILURE", { cause: error })));
        tlsSocket.once("secureConnect", () => {
          try {
            checkPeer(tlsSocket);
            if (!tlsSocket.authorized) throw new RetrievalError("TRANSPORT_FAILURE");
            finish(null, tlsSocket);
          } catch (error) {
            finish(error instanceof RetrievalError ? error : new RetrievalError("TRANSPORT_FAILURE", { cause: error }));
          }
        });
      } catch (error) {
        finish(error instanceof RetrievalError ? error : new RetrievalError("TRANSPORT_FAILURE", { cause: error }));
      }
    });
    return undefined;
  }
}

class PinnedHttpAgent extends http.Agent {
  constructor(options) {
    super({ keepAlive: false, maxSockets: 1 });
    this.connection = new PinnedAgentBase({ ...options, secure: false });
  }
  createConnection(options, callback) { return this.connection.createConnection(options, callback); }
}

class PinnedHttpsAgent extends https.Agent {
  constructor(options) {
    super({ keepAlive: false, maxSockets: 1 });
    this.connection = new PinnedAgentBase({ ...options, secure: true });
  }
  createConnection(options, callback) { return this.connection.createConnection(options, callback); }
}

function createContext(signal) {
  const controller = new AbortController();
  const context = {
    signal: controller.signal,
    deadline: performance.now() + DEFAULT_RUN_LIMITS.totalMilliseconds,
    deadlineReached: false,
  };
  const onAbort = () => controller.abort();
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    context.deadlineReached = true;
    controller.abort();
  }, DEFAULT_RUN_LIMITS.totalMilliseconds);
  return {
    context,
    close() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function makeHostHeader(hostname, port, protocol) {
  const host = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  const defaultPort = protocol === "https:" ? 443 : 80;
  return port === defaultPort ? host : `${host}:${port}`;
}

function requestOnce(validated, address, context, seam) {
  const { url, hostname, port } = validated;
  const secure = url.protocol === "https:";
  const agent = secure
    ? new PinnedHttpsAgent({
      address, port, hostname, signal: context.signal, onDial: seam?.onDial,
      isAllowedPeer: (peer) => sameAddress(peer, address),
      ca: seam?.testTlsCa,
    })
    : new PinnedHttpAgent({
      address, port, hostname, signal: context.signal, onDial: seam?.onDial,
      isAllowedPeer: (peer) => sameAddress(peer, address),
    });
  const requester = secure ? https.request : http.request;
  const options = {
    protocol: url.protocol,
    hostname: address,
    family: net.isIP(address),
    port,
    method: "GET",
    path: `${url.pathname}${url.search}`,
    agent,
    headers: {
      host: makeHostHeader(hostname, port, url.protocol),
      accept: ACCEPT,
      "accept-encoding": "gzip",
      "user-agent": "event-intelligence-controlled-retrieval/0.1",
      connection: "close",
    },
    setHost: false,
    maxHeaderSize: 16 * 1024,
  };
  return new Promise((resolve, reject) => {
    let request;
    const onAbort = () => request.destroy(new RetrievalError(context.deadlineReached ? "DEADLINE_EXCEEDED" : "CANCELED"));
    const cleanup = () => context.signal.removeEventListener("abort", onAbort);
    request = requester(options, (response) => resolve({ response, agent, request, cleanup }));
    context.signal.addEventListener("abort", onAbort, { once: true });
    if (context.signal.aborted) onAbort();
    request.once("error", (error) => {
      cleanup();
      agent.destroy();
      if (error instanceof RetrievalError) reject(error);
      else reject(new RetrievalError("TRANSPORT_FAILURE", { cause: error }));
    });
    request.end();
  });
}

function parseMime(contentType) {
  if (typeof contentType !== "string" || contentType.length > 256) throw new RetrievalError("UNSUPPORTED_MEDIA");
  const mime = contentType.split(";", 1)[0].trim().toLowerCase();
  if (!SUPPORTED_MIME.has(mime)) throw new RetrievalError("UNSUPPORTED_MEDIA");
  return mime;
}

function bodyLimit(mime) {
  return mime.startsWith("image/") || mime === "application/pdf"
    ? DEFAULT_RUN_LIMITS.decodedMediaBytesPerRequest
    : DEFAULT_RUN_LIMITS.decodedTextBytesPerRequest;
}

function readContentLength(value, maximum) {
  if (value === undefined) return;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new RetrievalError("RESOURCE_LIMIT");
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > maximum) throw new RetrievalError("RESOURCE_LIMIT");
}

async function consumeBody(response, mime, context, fetcherState) {
  throwIfStopped(context);
  const encoding = String(response.headers["content-encoding"] ?? "identity").toLowerCase().trim();
  if (encoding !== "identity" && encoding !== "gzip") throw new RetrievalError("UNSUPPORTED_MEDIA");
  const maximum = bodyLimit(mime);
  const declaredMaximum = encoding === "gzip" ? DEFAULT_RUN_LIMITS.compressedBytesPerRequest : maximum;
  readContentLength(response.headers["content-length"], declaredMaximum);
  let encoded = 0;
  let decoded = 0;
  let source = response;
  let completion;
  if (encoding === "gzip") {
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        encoded += chunk.length;
        if (encoded > DEFAULT_RUN_LIMITS.compressedBytesPerRequest) callback(new RetrievalError("RESOURCE_LIMIT"));
        else callback(null, chunk);
      },
    });
    const gunzip = createGunzip({ chunkSize: 16 * 1024 });
    source = gunzip;
    completion = pipeline(response, counter, gunzip).catch((error) => {
      if (!gunzip.destroyed) gunzip.destroy(error);
    });
  }
  const chunks = [];
  try {
    for await (const chunk of source) {
      throwIfStopped(context);
      decoded += chunk.length;
      if (decoded > maximum || fetcherState.decodedBytes + chunk.length > DEFAULT_RUN_LIMITS.decodedBytesPerRun) {
        throw new RetrievalError("RESOURCE_LIMIT");
      }
      fetcherState.decodedBytes += chunk.length;
      chunks.push(chunk);
    }
    if (completion) await completion;
  } catch (error) {
    response.destroy(error instanceof Error ? error : undefined);
    source.destroy?.(error instanceof Error ? error : undefined);
    if (context.deadlineReached) throw new RetrievalError("DEADLINE_EXCEEDED");
    if (context.signal.aborted && !(error instanceof RetrievalError)) throw new RetrievalError("CANCELED");
    throw error instanceof RetrievalError ? error : new RetrievalError("TRANSPORT_FAILURE", { cause: error });
  }
  return Buffer.concat(chunks, decoded);
}

function detectMime(body) {
  if (body.length >= 24 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && body.subarray(12, 16).toString("ascii") === "IHDR") return "image/png";
  if (body.length >= 6 && ["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 12 && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (body.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(body).replace(/^\uFEFF/, "").trimStart(); }
  catch { throw new RetrievalError("UNSUPPORTED_MEDIA"); }
  if (/^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(text) || /^<\?xml[\s\S]{0,256}<html\b/i.test(text)) return "text/html";
  if (text.startsWith("{") || text.startsWith("[")) {
    try { JSON.parse(text); return "application/json"; }
    catch { throw new RetrievalError("UNSUPPORTED_MEDIA"); }
  }
  if (text.includes("\u0000")) throw new RetrievalError("UNSUPPORTED_MEDIA");
  return "text/plain";
}

function imageSize(body, mime) {
  let width;
  let height;
  if (mime === "image/png" && body.length >= 24) {
    width = body.readUInt32BE(16);
    height = body.readUInt32BE(20);
  } else if (mime === "image/gif" && body.length >= 10) {
    width = body.readUInt16LE(6);
    height = body.readUInt16LE(8);
  } else if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 4 <= body.length) {
      if (body[offset] !== 0xff) throw new RetrievalError("UNSUPPORTED_MEDIA");
      while (body[offset] === 0xff) offset += 1;
      const marker = body[offset++];
      if ([0xd8, 0xd9, 0x01, ...Array.from({ length: 8 }, (_, index) => 0xd0 + index)].includes(marker)) continue;
      if (offset + 2 > body.length) break;
      const segmentLength = body.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > body.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (segmentLength < 7) throw new RetrievalError("UNSUPPORTED_MEDIA");
        height = body.readUInt16BE(offset + 3);
        width = body.readUInt16BE(offset + 5);
        break;
      }
      offset += segmentLength;
    }
  } else if (mime === "image/webp" && body.length >= 25) {
    const chunk = body.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X" && body.length >= 30) {
      width = 1 + body.readUIntLE(24, 3);
      height = 1 + body.readUIntLE(27, 3);
    } else if (chunk === "VP8 " && body.length >= 30) {
      if (body[23] === 0x9d && body[24] === 0x01 && body[25] === 0x2a) {
        width = body.readUInt16LE(26) & 0x3fff;
        height = body.readUInt16LE(28) & 0x3fff;
      }
    } else if (chunk === "VP8L" && body.length >= 25 && body[20] === 0x2f) {
      const b1 = body[21]; const b2 = body[22]; const b3 = body[23]; const b4 = body[24];
      width = 1 + (((b2 & 0x3f) << 8) | b1);
      height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    }
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RetrievalError("UNSUPPORTED_MEDIA");
  if (width > DEFAULT_RUN_LIMITS.imageMaximumDimension || height > DEFAULT_RUN_LIMITS.imageMaximumDimension
    || width * height > DEFAULT_RUN_LIMITS.imageMaximumPixels) throw new RetrievalError("RESOURCE_LIMIT");
  return Object.freeze({ width, height });
}

function validateFinalBody(body, declaredMime) {
  const detected = detectMime(body);
  const accepted = declaredMime === "application/xhtml+xml"
    ? detected === "text/html"
    : declaredMime === "application/ld+json"
      ? detected === "application/json"
      : detected === declaredMime;
  if (!accepted) throw new RetrievalError("UNSUPPORTED_MEDIA");
  const dimensions = declaredMime.startsWith("image/") ? imageSize(body, declaredMime) : undefined;
  return dimensions;
}

export class SafeFetcher {
  #seam;
  #state = { requestCount: 0, decodedBytes: 0 };
  #semaphore = new FetchSemaphore();

  constructor(testOptions) {
    this.#seam = getTestSeam(testOptions);
  }

  async fetch(input, options = {}) {
    const unknownOptions = Object.keys(options).filter((key) => key !== "signal");
    if (unknownOptions.length > 0) throw new RetrievalError("POLICY_DENIED");
    const externalSignal = options.signal;
    const { context, close: closeContext } = createContext(externalSignal);
    let release;
    try {
      release = await this.#semaphore.acquire(context);
      let current = input;
      let redirects = 0;
      while (true) {
        throwIfStopped(context);
        if (this.#state.requestCount >= DEFAULT_RUN_LIMITS.requests) throw new RetrievalError("REQUEST_LIMIT");
        this.#state.requestCount += 1;
        const validated = this.#seam?.validateUrl
          ? this.#seam.validateUrl(current)
          : parseAndValidateUrl(current);
        const host = validateHostnameForResolver(validated.hostname, this.#seam);
        const resolved = this.#seam?.resolve
          ? await this.#seam.resolve(host, { signal: context.signal, deadline: context.deadline })
          : await resolveSystemHost(host, { signal: context.signal, deadline: context.deadline });
        throwIfStopped(context);
        if (!resolved || !Array.isArray(resolved.addresses) || resolved.addresses.length === 0) throw new RetrievalError("DNS_FAILURE");
        for (const alias of resolved.aliases ?? []) {
          if (isIPHost(alias)) throw new RetrievalError("DNS_FAILURE");
          validateHostnameForResolver(alias, this.#seam);
        }
        for (const address of resolved.addresses) assertAllowedAddress(address, this.#seam);
        const chosenAddress = resolved.addresses[0];
        let result;
        try {
          result = await requestOnce(validated, chosenAddress, context, this.#seam);
        } catch (error) {
          if (context.deadlineReached) throw new RetrievalError("DEADLINE_EXCEEDED");
          throw error;
        }
        const { response, agent, request, cleanup } = result;
        const finishTransport = () => {
          cleanup();
          agent.destroy();
        };
        if (REDIRECT_CODES.has(response.statusCode)) {
          const location = response.headers.location;
          response.destroy();
          finishTransport();
          if (redirects >= DEFAULT_RUN_LIMITS.redirectsPerFetch) throw new RetrievalError("REDIRECT_LIMIT");
          if (typeof location !== "string" || location.length > 8_192) throw new RetrievalError("POLICY_DENIED");
          let next;
          try { next = new URL(location, validated.url).toString(); }
          catch { throw new RetrievalError("POLICY_DENIED"); }
          // Validate each redirect before consuming a request slot or starting DNS/socket work.
          if (this.#seam?.validateUrl) this.#seam.validateUrl(next);
          else parseAndValidateUrl(next);
          redirects += 1;
          current = next;
          continue;
        }
        try {
          if (response.statusCode !== 200) throw new RetrievalError("TRANSPORT_FAILURE");
          const mime = parseMime(response.headers["content-type"]);
          const body = await consumeBody(response, mime, context, this.#state);
          const dimensions = validateFinalBody(body, mime);
          return Object.freeze({
            url: validated.url.toString(),
            contentType: mime,
            bytes: body,
            fetchedAt: new Date().toISOString(),
            redirects,
            ...(dimensions ? { image: dimensions } : {}),
          });
        } finally {
          finishTransport();
        }
      }
    } catch (error) {
      if (context.deadlineReached) throw new RetrievalError("DEADLINE_EXCEEDED");
      if (externalSignal?.aborted) throw new RetrievalError("CANCELED");
      if (error instanceof RetrievalError) throw error;
      throw new RetrievalError("TRANSPORT_FAILURE", { cause: error });
    } finally {
      release?.();
      closeContext();
    }
  }
}

function isIPHost(hostname) { return net.isIP(String(hostname).replace(/^\[|\]$/g, "")) !== 0; }

function validateHostnameForResolver(hostname, seam) {
  if (seam?.validateHostname) return seam.validateHostname(hostname);
  return validateHostname(hostname);
}
