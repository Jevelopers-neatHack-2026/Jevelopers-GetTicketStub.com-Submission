import "server-only";
import type { Stub } from "@/customer/studio/types";
import { externalizeArt } from "./files";
import { isDisposableEmail } from "./disposable";
import { HttpError, isObject } from "./http";

const bad = (message: string) => new HttpError(400, "bad_request", message);

export const MAX_STUB_BYTES = 2 * 1024 * 1024;
/** Request-body room for stubs that still carry embedded art (each image is capped at 6 MB). */
export const MAX_STUB_BODY = 9 * 1024 * 1024;

const EMAIL = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[^\s@<>()"',;:\\]+$/;

export function parseEmail(v: unknown): string {
  const email = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (email.length < 5 || email.length > 254 || !EMAIL.test(email)) throw bad("That email doesn't look right. Check it and try again.");
  return email;
}

/** For sign-in and email change: a valid address that isn't a throwaway one. */
export function parseAccountEmail(v: unknown): string {
  const email = parseEmail(v);
  if (isDisposableEmail(email)) throw new HttpError(400, "disposable_email", "That looks like a throwaway address. Use an email you keep, so we can find your wall again.");
  return email;
}

/** Only a path on this site: starts with one "/", never "//" or "/\", no control characters. Otherwise the fallback. */
export function safeReturnTo(v: unknown, fallback = "/wall"): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 500) return fallback;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return fallback;
  return v;
}

/** Adds signedIn=1 to a relative path, keeping its query and hash. */
export function withSignedIn(path: string): string {
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const rest = hashAt >= 0 ? path.slice(0, hashAt) : path;
  return `${rest}${rest.includes("?") ? "&" : "?"}signedIn=1${hash}`;
}

/**
 * Checks the shape of a stub we received: an id string and an event object, plus the parts the
 * studio always reads. Nothing in it is trusted for authorization. Photos are local-only, so they are dropped.
 */
function parseStub(v: unknown, now: number): Stub {
  if (!isObject(v)) throw bad("A stub is missing.");
  const { id, event, versions, personal, createdAt, updatedAt } = v;
  if (typeof id !== "string" || id.length < 1 || id.length > 128 || !/^[\w.:-]+$/.test(id)) throw bad("A stub has no valid id.");
  if (!isObject(event) || typeof event.title !== "string") throw bad("A stub has no event.");
  if (!Array.isArray(versions) || !isObject(personal)) throw bad("A stub is incomplete.");
  if (createdAt !== undefined && typeof createdAt !== "string") throw bad("A stub has a bad date.");
  let stamp: number | undefined;
  if (updatedAt !== undefined) {
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt < 0) throw bad("A stub has a bad update time.");
    stamp = Math.min(Math.floor(updatedAt), now + 24 * 3600_000); // a wrong clock can't pin a stub forever
  }
  const stub = { ...v, photos: [], ...(stamp === undefined ? {} : { updatedAt: stamp }) } as unknown as Stub;
  return stub;
}

/**
 * Validates a stub we received, moves its embedded art out to files, then bounds what is left. The size
 * check comes after the move, so a big image doesn't count against the stub, only its small URL does.
 * Nothing but the art strings changes: updatedAt stays as sent.
 */
export function readStub(v: unknown, now: number): Stub {
  const stub = externalizeArt(parseStub(v, now));
  if (JSON.stringify(stub).length > MAX_STUB_BYTES) throw new HttpError(413, "too_large", "A stub is too large to save.");
  return stub;
}

export function parseText(v: unknown, max: number, what: string): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw bad(`${what} is missing or too long.`);
  return v.trim();
}

/** A URL token from the path. Anything outside the alphabet we mint is a 404, not a database lookup. */
export function parseToken(v: string): string {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(v)) throw new HttpError(404, "not_found", "We couldn't find that.");
  return v;
}

export const GIFT_MESSAGE_MAX = 280;
export const GIFT_TO_MAX = 40;

/** Gift text: a string with control characters removed (newlines kept), trimmed and cut at `max`. Empty when it isn't text. */
export function cleanGiftText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/\r/g, "").trim().slice(0, max);
}
