import { LINK_TTL_MS, sandboxMail } from "@/server/auth";
import { accountOf, getRequestContext, requireCapability } from "@/server/context";
import { hashToken, newToken } from "@/server/crypto";
import { HttpError, appOrigin, checkOrigin, clientIp, isObject, json, limit, readJson, route } from "@/server/http";
import { getStorage, requireStorage } from "@/server/index";
import { sendMail } from "@/server/mail";
import { emailChangeMail, stubImageUrl } from "@/server/templates";
import { parseAccountEmail } from "@/server/validate";

const WINDOW = 15 * 60_000;

// Sends a confirm link to the NEW address. Nothing changes until it is opened.
export const POST = route(async (req: Request) => {
  requireStorage();
  checkOrigin(req);
  const ctx = await getRequestContext(req);
  requireCapability(ctx, "account.email.change");
  const account = await accountOf(ctx);
  limit(`email:ip:${clientIp(req)}`, 20, WINDOW);
  limit(`email:acct:${account.id}`, 5, WINDOW);
  const body = await readJson(req, 4 * 1024);
  if (!isObject(body)) throw new HttpError(400, "bad_request", "Send { email }.");
  const email = parseAccountEmail(body.email);
  if (email === account.email) throw new HttpError(400, "same_email", "That's already your email.");

  const now = Date.now();
  const token = newToken();
  await getStorage().createLoginLink(hashToken(token), { email, returnTo: "/account", reason: "email", accountId: account.id }, now, now + LINK_TTL_MS);
  const origin = appOrigin(req);
  const url = `${origin}/signin/confirm?token=${token}`;

  const { delivered } = await sendMail(email, emailChangeMail(url, stubImageUrl(origin)), "email change link");
  if (delivered) return json({ ok: true });
  if (!sandboxMail()) throw new HttpError(503, "mail_unavailable", "Email isn't set up on this server yet.");
  console.log(`[mail] sandbox email-change link for ${email}: ${url}`);
  return json({ ok: true, sandbox: true, devLink: url });
});
