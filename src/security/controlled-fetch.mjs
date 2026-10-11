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
import { recordSafeFetchProvenance, safeFetchLifecycleFor } from "./internal/fetch-lifecycle.mjs";

export { RetrievalError };

export const DEFAULT_RUN_LIMITS = Object.freeze({
  requests: 30,
  redirectsPerFetch: 5,
  concurrentFetches: 4,
  connectMilliseconds: 10_000,
  totalMilliseconds: 30_000,
  wireBytesPerRequest: 10 * 1024 * 1024,
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
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;

function signalIsAborted(signal) {
  return Reflect.apply(ABORTED_GETTER, signal, []);
}

function addSignalListener(signal, listener) {
  Reflect.apply(ADD_EVENT_LISTENER, signal, ["abort", listener, { once: true }]);
}

function removeSignalListener(signal, listener) {
  try { Reflect.apply(REMOVE_EVENT_LISTENER, signal, ["abort", listener]); }
  catch { /* Caller-owned signal cleanup must never replace the retrieval result. */ }
}

function throwIfStopped(context) {
  if (context.deadlineReached) throw new RetrievalError("DEADLINE_EXCEEDED");
  if (signalIsAborted(context.signal)) throw new RetrievalError("CANCELED");
  if (performance.now() >= context.deadline) throw new RetrievalError("DEADLINE_EXCEEDED");
}

function validateFetchOptions(options) {
  try {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new RetrievalError("POLICY_DENIED");
    }
    const prototype = Object.getPrototypeOf(options);
    if (prototype !== Object.prototype && prototype !== null) throw new RetrievalError("POLICY_DENIED");
    const keys = Reflect.ownKeys(options);
    if (keys.some((key) => key !== "signal")) throw new RetrievalError("POLICY_DENIED");
    const descriptor = Object.getOwnPropertyDescriptor(options, "signal");
    if (descriptor && !("value" in descriptor)) throw new RetrievalError("POLICY_DENIED");
    const signal = descriptor?.value;
    if (signal !== undefined && (typeof ABORTED_GETTER !== "function"
      || typeof ADD_EVENT_LISTENER !== "function" || typeof REMOVE_EVENT_LISTENER !== "function"
      || typeof signalIsAborted(signal) !== "boolean")) {
      throw new RetrievalError("POLICY_DENIED");
    }
    return signal;
  } catch {
    throw new RetrievalError("POLICY_DENIED");
  }
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
        removeSignalListener(context.signal, entry.abort);
      };
      entry.abort = () => {
        remove();
        reject(context.deadlineReached ? new RetrievalError("DEADLINE_EXCEEDED") : new RetrievalError("CANCELED"));
      };
      entry.timer = setTimeout(() => {
        remove();
        reject(new RetrievalError("DEADLINE_EXCEEDED"));
      }, Math.max(1, context.deadline - performance.now()));
      addSignalListener(context.signal, entry.abort);
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
      removeSignalListener(entry.context.signal, entry.abort);
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
      removeSignalListener(this.signal, onAbort);
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
    addSignalListener(this.signal, onAbort);
    if (signalIsAborted(this.signal)) return onAbort();
    raw.once("error", () => finish(new RetrievalError("TRANSPORT_FAILURE")));
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
        tlsSocket.once("error", () => finish(new RetrievalError("TRANSPORT_FAILURE")));
        tlsSocket.once("secureConnect", () => {
          try {
            checkPeer(tlsSocket);
            if (!tlsSocket.authorized) throw new RetrievalError("TRANSPORT_FAILURE");
            finish(null, tlsSocket);
          } catch (error) {
            finish(error instanceof RetrievalError ? error : new RetrievalError("TRANSPORT_FAILURE"));
          }
        });
      } catch (error) {
        finish(error instanceof RetrievalError ? error : new RetrievalError("TRANSPORT_FAILURE"));
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

function createContext(signal, totalMilliseconds = DEFAULT_RUN_LIMITS.totalMilliseconds) {
  const controller = new AbortController();
  const context = {
    signal: controller.signal,
    deadline: performance.now() + totalMilliseconds,
    deadlineReached: false,
  };
  const onAbort = () => controller.abort();
  if (signal && signalIsAborted(signal)) onAbort();
  else if (signal) addSignalListener(signal, onAbort);
  const timer = setTimeout(() => {
    context.deadlineReached = true;
    controller.abort();
  }, totalMilliseconds);
  return {
    context,
    close() {
      clearTimeout(timer);
      if (signal) removeSignalListener(signal, onAbort);
      controller.abort();
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
    const cleanup = () => removeSignalListener(context.signal, onAbort);
    request = requester(options, (response) => resolve({ response, agent, request, cleanup }));
    addSignalListener(context.signal, onAbort);
    if (signalIsAborted(context.signal)) onAbort();
    request.once("error", (error) => {
      cleanup();
      agent.destroy();
      if (error instanceof RetrievalError) reject(error);
      else reject(new RetrievalError("TRANSPORT_FAILURE"));
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

async function consumeBody(response, mime, context, fetcherState, lifecycle, onDecodeStart) {
  throwIfStopped(context);
  const encoding = String(response.headers["content-encoding"] ?? "identity").toLowerCase().trim();
  if (encoding !== "identity" && encoding !== "gzip") throw new RetrievalError("UNSUPPORTED_MEDIA");
  const maximum = mime.startsWith("image/") || mime === "application/pdf"
    ? lifecycle?.options.decodedMediaBytesPerResponse ?? DEFAULT_RUN_LIMITS.decodedMediaBytesPerRequest
    : lifecycle?.options.decodedTextBytesPerResponse ?? DEFAULT_RUN_LIMITS.decodedTextBytesPerRequest;
  const wireMaximum = DEFAULT_RUN_LIMITS.wireBytesPerRequest;
  readContentLength(response.headers["content-length"], wireMaximum);
  let encoded = 0;
  let decoded = 0;
  let completion;
  let wireGuard;
  let gunzip;
  let producedDecoded = 0;
  const chunkSize = lifecycle?.options.gzipChunkSize ?? 16 * 1024;
  const readableHighWaterMark = lifecycle?.options.gzipReadableHighWaterMark ?? 64 * 1024;
  const writableHighWaterMark = lifecycle?.options.gzipWritableHighWaterMark ?? 16 * 1024;
  wireGuard = new Transform({
    transform(chunk, _encoding, callback) {
      encoded += chunk.length;
      if (encoded > wireMaximum) callback(new RetrievalError("RESOURCE_LIMIT"));
      else callback(null, chunk);
    },
    readableHighWaterMark: writableHighWaterMark,
    writableHighWaterMark,
  });
  const outputGuard = new Transform({
    transform(chunk, _encoding, callback) {
      producedDecoded += chunk.length;
      if (producedDecoded > maximum) callback(new RetrievalError("RESOURCE_LIMIT"));
      else callback(null, chunk);
    },
    readableHighWaterMark,
    writableHighWaterMark,
  });
  if (encoding === "gzip") {
    gunzip = createGunzip({
      chunkSize,
      readableHighWaterMark,
      writableHighWaterMark,
    });
  }
  const chunks = [];
  try {
    await onDecodeStart();
    throwIfStopped(context);
    completion = (gunzip
      ? pipeline(response, wireGuard, gunzip, outputGuard)
      : pipeline(response, wireGuard, outputGuard)).catch((error) => {
      // The iterator below observes stream errors. Keep the completion promise
      // handled as well so a concurrent pipeline rejection cannot go unobserved.
      if (!outputGuard.destroyed) outputGuard.destroy(error);
    });
    for await (const chunk of outputGuard) {
      throwIfStopped(context);
      decoded += chunk.length;
      if (decoded > maximum || fetcherState.decodedBytes + chunk.length > DEFAULT_RUN_LIMITS.decodedBytesPerRun) {
        throw new RetrievalError("RESOURCE_LIMIT");
      }
      fetcherState.decodedBytes += chunk.length;
      chunks.push(Buffer.from(chunk));
    }
    if (completion) await completion;
    return Buffer.concat(chunks, decoded);
  } catch (error) {
    response.destroy(error instanceof Error ? error : undefined);
    outputGuard.destroy(error instanceof Error ? error : undefined);
    wireGuard.destroy(error instanceof Error ? error : undefined);
    gunzip?.destroy(error instanceof Error ? error : undefined);
    if (completion) await completion;
    if (context.deadlineReached) throw new RetrievalError("DEADLINE_EXCEEDED");
    if (signalIsAborted(context.signal) && !(error instanceof RetrievalError)) throw new RetrievalError("CANCELED");
    throw error instanceof RetrievalError ? error : new RetrievalError("TRANSPORT_FAILURE");
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
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
    let externalSignal;
    let context;
    let closeContext = () => {};
    let release;
    try {
      externalSignal = validateFetchOptions(options);
      const lifecycle = safeFetchLifecycleFor(this);
      const createdContext = createContext(externalSignal,
        lifecycle?.options.totalMilliseconds ?? DEFAULT_RUN_LIMITS.totalMilliseconds);
      context = createdContext.context;
      closeContext = createdContext.close;
      release = await this.#semaphore.acquire(context);
      let current = input;
      let firstHopUrl;
      let redirects = 0;
      const redirectChain = [];
      const hops = [];
      while (true) {
        throwIfStopped(context);
        if (this.#state.requestCount >= DEFAULT_RUN_LIMITS.requests) throw new RetrievalError("REQUEST_LIMIT");
        // Keep historical per-instance accounting: even a URL rejected during parsing consumes a slot.
        this.#state.requestCount += 1;
        const validated = this.#seam?.validateUrl
          ? this.#seam.validateUrl(current)
          : parseAndValidateUrl(current);
        if (firstHopUrl === undefined) firstHopUrl = validated.url.href;
        const hopIndex = hops.length;
        let hopAdmissionReturned = false;
        try {
          await lifecycle?.hooks.beforeHop?.(Object.freeze({ url: validated.url.href, hopIndex, redirects }));
          hopAdmissionReturned = true;
          throwIfStopped(context);
        } catch (error) {
          if (hopAdmissionReturned) await lifecycle?.hooks.onKnownZero?.(Object.freeze({ hopIndex, reason: "before_dispatch_stopped" }));
          throw error;
        }
        const hop = { url: validated.url.href, statusCode: null, dispatchIntent: false,
          responseReceived: false, bodyComplete: false, decodedBytes: null };
        hops.push(hop);
        let resolved;
        try {
          const host = validateHostnameForResolver(validated.hostname, this.#seam);
          resolved = this.#seam?.resolve
            ? await this.#seam.resolve(host, { signal: context.signal, deadline: context.deadline })
            : await resolveSystemHost(host, { signal: context.signal, deadline: context.deadline });
          throwIfStopped(context);
          if (!resolved || !Array.isArray(resolved.addresses) || resolved.addresses.length === 0) throw new RetrievalError("DNS_FAILURE");
          for (const alias of resolved.aliases ?? []) {
            if (isIPHost(alias)) throw new RetrievalError("DNS_FAILURE");
            validateHostnameForResolver(alias, this.#seam);
          }
          for (const address of resolved.addresses) assertAllowedAddress(address, this.#seam);
        } catch (error) {
          await lifecycle?.hooks.onKnownZero?.(Object.freeze({ hopIndex, reason: "pre_dispatch_failure" }));
          throw error;
        }
        const chosenAddress = resolved.addresses[0];
        let result;
        try {
          await lifecycle?.hooks.onDispatchIntent?.(Object.freeze({ url: validated.url.href, hopIndex }));
          throwIfStopped(context);
        } catch (error) {
          await lifecycle?.hooks.onKnownZero?.(Object.freeze({ hopIndex, reason: "dispatch_not_started" }));
          throw error;
        }
        hop.dispatchIntent = true;
        try {
          result = await requestOnce(validated, chosenAddress, context, this.#seam);
        } catch (error) {
          await lifecycle?.hooks.onKnownZero?.(Object.freeze({ hopIndex, reason: "no_response" }));
          if (context.deadlineReached) throw new RetrievalError("DEADLINE_EXCEEDED");
          throw error;
        }
        const { response, agent, request, cleanup } = result;
        const finishTransport = () => {
          cleanup();
          agent.destroy();
        };
        let body;
        let returnedBody = false;
        hop.statusCode = response.statusCode;
        hop.responseReceived = true;
        try {
          await lifecycle?.hooks.onResponseHeaders?.(Object.freeze({
            url: validated.url.href, hopIndex, statusCode: response.statusCode,
          }));
          throwIfStopped(context);
        } catch (error) {
          response.destroy();
          finishTransport();
          throw error;
        }
        if (REDIRECT_CODES.has(response.statusCode)) {
          const location = response.headers.location;
          response.destroy();
          finishTransport();
          await lifecycle?.hooks.onKnownZero?.(Object.freeze({ hopIndex, reason: "redirect" }));
          throwIfStopped(context);
          if (redirects >= DEFAULT_RUN_LIMITS.redirectsPerFetch) throw new RetrievalError("REDIRECT_LIMIT");
          if (typeof location !== "string" || location.length > 8_192) throw new RetrievalError("POLICY_DENIED");
          let next;
          try { next = new URL(location, validated.url).toString(); }
          catch { throw new RetrievalError("POLICY_DENIED"); }
          // Validate each redirect before consuming a request slot or starting DNS/socket work.
          const validatedNext = this.#seam?.validateUrl
            ? this.#seam.validateUrl(next)
            : parseAndValidateUrl(next);
          redirectChain.push(validatedNext.url.href);
          redirects += 1;
          current = next;
          continue;
        }
        try {
          if (response.statusCode !== 200) {
            await lifecycle?.hooks.onKnownZero?.(Object.freeze({ hopIndex, reason: "status_rejected" }));
            throwIfStopped(context);
            throw new RetrievalError("TRANSPORT_FAILURE");
          }
          let mime;
          try { mime = parseMime(response.headers["content-type"]); }
          catch (error) {
            await lifecycle?.hooks.onKnownZero?.(Object.freeze({ hopIndex, reason: "content_type_rejected" }));
            throwIfStopped(context);
            throw error;
          }
          let decodeStarted = false;
          try {
            body = await consumeBody(response, mime, context, this.#state, lifecycle, async () => {
              decodeStarted = true;
              await lifecycle?.hooks.onDecodeStart?.(Object.freeze({ hopIndex, mime }));
            });
          } catch (error) {
            if (!decodeStarted) await lifecycle?.hooks.onKnownZero?.(Object.freeze({ hopIndex, reason: "body_decode_not_started" }));
            throw error;
          }
          hop.bodyComplete = true;
          hop.decodedBytes = body.byteLength;
          await lifecycle?.hooks.onBodyComplete?.(Object.freeze({ hopIndex, decodedBytes: body.byteLength }));
          throwIfStopped(context);
          const dimensions = validateFinalBody(body, mime);
          const fetched = Object.freeze({
            url: validated.url.toString(),
            contentType: mime,
            bytes: body,
            fetchedAt: new Date().toISOString(),
            redirects,
            ...(dimensions ? { image: dimensions } : {}),
          });
          recordSafeFetchProvenance(fetched, {
            requestedUrl: firstHopUrl,
            finalUrl: validated.url.href,
            redirectChain,
            hops,
          });
          returnedBody = true;
          return fetched;
        } finally {
          if (!returnedBody && body) body.fill(0);
          finishTransport();
        }
      }
    } catch (error) {
      if (context?.deadlineReached) throw new RetrievalError("DEADLINE_EXCEEDED");
      if (externalSignal && signalIsAborted(externalSignal)) throw new RetrievalError("CANCELED");
      if (error instanceof RetrievalError) throw error;
      throw new RetrievalError("TRANSPORT_FAILURE");
    } finally {
      closeContext();
      release?.();
    }
  }
}

function isIPHost(hostname) { return net.isIP(String(hostname).replace(/^\[|\]$/g, "")) !== 0; }

function validateHostnameForResolver(hostname, seam) {
  if (seam?.validateHostname) return seam.validateHostname(hostname);
  return validateHostname(hostname);
}
