import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A new random secret: 256 bits, URL-safe. */
export const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Tokens are stored as SHA-256 hex only, never in the clear. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Constant-time string compare. Unequal lengths are unequal without comparing bytes. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
