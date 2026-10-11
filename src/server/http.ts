import "server-only";
import { NextResponse } from "next/server";
import { hit } from "./ratelimit";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

const NO_STORE = { "cache-control": "no-store" };

export function json(data: unknown, init?: { status?: number; headers?: Record<string, string> }): NextResponse {
  return NextResponse.json(data, { status: init?.status ?? 200, headers: { ...NO_STORE, ...init?.headers } });
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) {
    return json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: e.headers });
  }
  // Log the message only: bodies, tokens and cookies never reach the log.
  console.error("[api] unexpected error:", e instanceof Error ? e.message : "unknown");
  return json({ error: { code: "internal", message: "Something broke on our side. Try again in a moment." } }, { status: 500 });
}

/** Wraps a handler so thrown HttpErrors become `{ error: { code, message } }`. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export const notFound = () => new HttpError(404, "not_found", "We couldn't find that.");

/** The public origin, for links in emails. APP_URL wins; otherwise the request's own origin. */
export function appOrigin(req: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall through to the request origin */
    }
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Mutating routes only accept a browser Origin that is APP_URL or this request's own host. */
export function checkOrigin(req: Request): void {
  const deny = () => new HttpError(403, "bad_origin", "This request didn't come from TicketStub.");
  const origin = req.headers.get("origin");
  if (!origin) throw deny();
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw deny();
  }
  const own = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  let allowed = parsed.host.toLowerCase() === own;
  const configured = process.env.APP_URL?.trim();
  if (!allowed && configured) {
    try {
      allowed = parsed.origin === new URL(configured).origin;
    } catch {
      /* ignore a malformed APP_URL */
    }
  }
  if (!allowed) throw deny();
}

/** True when the request carries an Origin that isn't ours. A missing Origin is not foreign: for the routes that guests may call without one. */
export function foreignOrigin(req: Request): boolean {
  if (!req.headers.get("origin")) return false;
  try {
    checkOrigin(req);
    return false;
  } catch {
    return true;
  }
}

/** Reads a JSON body, refusing anything over `maxBytes` before it is parsed. */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const tooBig = () => new HttpError(413, "too_large", "That's too much to send in one go.");
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooBig();
  if (!req.body) throw new HttpError(400, "bad_json", "Send a JSON body.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_json", "Send a JSON body.");
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

/** Throws 429 when `key` has used up `max` hits in the window. */
export function limit(key: string, max: number, windowMs: number): void {
  const wait = hit(key, max, windowMs);
  if (wait) {
    throw new HttpError(429, "rate_limited", `Too many tries. Wait ${Math.ceil(wait / 60)} min and try again.`, { "retry-after": String(wait) });
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
