import "server-only";
import { hashToken } from "./crypto";
import { getStorage, storageAvailable } from "./index";

// Email links open a page, and only a tap on that page uses the link up. A mail scanner that fetches the
// URL sees the page and burns nothing. These helpers look a link up without consuming it.

export const maskEmail = (email: string) => email.replace(/^(.)[^@]*(@.*)$/, "$1***$2");

export type LinkLookup =
  | { valid: false }
  | { valid: true; kind: "signin" | "email"; reason: string; email: string; maskedEmail: string; shareToken: string | null };

export async function lookupLink(token: string): Promise<LinkLookup> {
  if (!token || token.length > 200 || !storageAvailable()) return { valid: false };
  const link = await getStorage().peekLoginLink(hashToken(token), Date.now());
  if (!link) return { valid: false };
  return { valid: true, kind: link.kind, reason: link.reason, email: link.email, maskedEmail: maskEmail(link.email), shareToken: link.shareToken ?? null };
}
