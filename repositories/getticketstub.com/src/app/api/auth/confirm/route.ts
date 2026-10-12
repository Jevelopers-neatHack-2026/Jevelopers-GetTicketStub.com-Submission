import { getSession, sessionCookie, startSession } from "@/server/auth";
import { guestTenant, readDevice } from "@/server/context";
import { lookupLink } from "@/server/confirm";
import { recordEvent } from "@/server/event-log";
import { hashToken } from "@/server/crypto";
import { HttpError, checkOrigin, isObject, json, readJson, route } from "@/server/http";
import { getStorage, requireStorage } from "@/server/index";
import { withSignedIn } from "@/server/validate";

// The two halves of a confirm page. GET looks the link up and never consumes it. POST is the tap that does:
// it signs in (or swaps the email) and answers 303. A form post and a JSON post both work.
const redirect = (to: string, cookie?: string) =>
  new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) } });

export const GET = route(async (req: Request) => {
  requireStorage();
  const found = await lookupLink(new URL(req.url).searchParams.get("token") ?? "");
  if (!found.valid) return json({ valid: false });
  return json({ valid: true, kind: found.kind, reason: found.reason, maskedEmail: found.maskedEmail, shareToken: found.shareToken });
});

async function readToken(req: Request): Promise<string> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 4096) throw new HttpError(413, "too_large", "That's too much to send in one go.");
  if ((req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    if (text.length > 4096) throw new HttpError(413, "too_large", "That's too much to send in one go.");
    return new URLSearchParams(text).get("token") ?? "";
  }
  const body = await readJson(req, 4096);
  return isObject(body) && typeof body.token === "string" ? body.token : "";
}

export const POST = route(async (req: Request) => {
  requireStorage();
  checkOrigin(req);
  const token = await readToken(req);
  const found = await lookupLink(token);
  const storage = getStorage();
  const now = Date.now();
  // A dead link can be either kind. Someone who is signed in was most likely changing their email.
  if (!found.valid) return redirect((await getSession(req)) ? "/account?email=expired" : "/wall?signin=expired");

  if (found.kind === "email") {
    const link = await storage.consumeLoginLink(hashToken(token), now, "email");
    if (!link?.accountId) return redirect("/account?email=expired");
    const result = await storage.changeEmail(link.accountId, link.email);
    return redirect(result === "changed" ? "/account?email=changed" : result === "taken" ? "/account?email=taken" : "/account?email=expired");
  }

  const link = await storage.consumeLoginLink(hashToken(token), now, "signin");
  if (!link) return redirect("/wall?signin=expired");
  const account = await storage.findOrCreateAccount(link.email, now);
  // The guest drafts shared from this device become the account's: it just proved the email, and the device cookie is server-issued.
  const device = readDevice(req);
  if (device) await storage.adoptShares(guestTenant(device), account.id);
  const session = await startSession(account.id);
  await recordEvent(req, "signed_in", {}, { account: account.id });
  return redirect(withSignedIn(link.returnTo), sessionCookie(session));
});
