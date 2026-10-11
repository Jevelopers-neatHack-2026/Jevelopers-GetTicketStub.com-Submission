import "server-only";
import { HttpError } from "./http";
import { hashToken, newToken } from "./crypto";
import { getStorage, storageAvailable } from "./index";
import type { Account } from "./storage";

export const COOKIE = "ts_session";
export const LINK_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 90 * 24 * 3600_000;

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

const attrs = () => `Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

export const sessionCookie = (token: string) => `${COOKIE}=${token}; ${attrs()}; Max-Age=${SESSION_TTL_MS / 1000}`;
export const clearedCookie = () => `${COOKIE}=; ${attrs()}; Max-Age=0`;

export async function startSession(accountId: string): Promise<string> {
  const token = newToken();
  const now = Date.now();
  await getStorage().createSession(hashToken(token), accountId, now, now + SESSION_TTL_MS);
  return token;
}

export async function getSession(req: Request): Promise<Account | null> {
  const token = readCookie(req, COOKIE);
  if (!token || token.length > 200 || !storageAvailable()) return null;
  return getStorage().getSessionAccount(hashToken(token), Date.now());
}

export async function requireSession(req: Request): Promise<Account> {
  const account = await getSession(req);
  if (!account) throw new HttpError(401, "unauthorized", "Sign in with an emailed link to do that.");
  return account;
}

export async function endSession(req: Request): Promise<void> {
  const token = readCookie(req, COOKIE);
  if (token && token.length <= 200 && storageAvailable()) await getStorage().deleteSession(hashToken(token));
}

/** devLink goes back to the UI only outside production, or when the sandbox flag is on. */
/** Sandbox sign-in links show on screen in development, in the demo preview (not live mode), or when asked. */
export const sandboxMail = () =>
  process.env.NODE_ENV !== "production" || process.env.TICKETSTUB_RUNTIME_MODE !== "live" || process.env.TICKETSTUB_SANDBOX_MAIL === "1";
