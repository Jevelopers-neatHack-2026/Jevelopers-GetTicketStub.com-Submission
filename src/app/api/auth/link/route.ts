import { LINK_TTL_MS, sandboxMail } from "@/server/auth";
import { hashToken, newToken } from "@/server/crypto";
import { HttpError, appOrigin, checkOrigin, clientIp, isObject, json, limit, readJson, route } from "@/server/http";
import { getStorage, requireStorage } from "@/server/index";
import { sendMail } from "@/server/mail";
import { magicLinkMail, stubImageUrl } from "@/server/templates";
import { parseAccountEmail, safeReturnTo } from "@/server/validate";

const WINDOW = 15 * 60_000;
const REASONS = ["save", "checkout", "claim"] as const;

export const POST = route(async (req: Request) => {
  requireStorage();
  checkOrigin(req);
  limit(`link:ip:${clientIp(req)}`, 20, WINDOW);
  const body = await readJson(req, 4 * 1024);
  if (!isObject(body)) throw new HttpError(400, "bad_request", "Send an email address.");
  const email = parseAccountEmail(body.email);
  const reason = REASONS.find((r) => r === body.reason);
  if (!reason) throw new HttpError(400, "bad_request", "Say why you're signing in: save, checkout or claim.");
  const returnTo = safeReturnTo(body.returnTo);
  // Optional, additive: the share token of the stub being saved, so the email can show it.
  const shareToken = typeof body.shareToken === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(body.shareToken) && (await getStorage().getShare(body.shareToken)) ? body.shareToken : null;
  limit(`link:email:${email}`, 5, WINDOW);

  const storage = getStorage();
  const now = Date.now();
  await storage.prune(now);
  const token = newToken();
  await storage.createLoginLink(hashToken(token), { email, returnTo, reason, shareToken }, now, now + LINK_TTL_MS);
  const url = `${appOrigin(req)}/signin/confirm?token=${token}`;

  const { delivered } = await sendMail(email, magicLinkMail(reason, url, stubImageUrl(appOrigin(req), shareToken)), "sign-in link");
  if (delivered) return json({ ok: true });
  if (!sandboxMail()) throw new HttpError(503, "mail_unavailable", "Email isn't set up on this server yet.");
  // Sandbox: no mail key, so the link is logged here and handed to the UI for its "Open the link" button.
  console.log(`[mail] sandbox sign-in link for ${email}: ${url}`);
  return json({ ok: true, sandbox: true, devLink: url });
});
