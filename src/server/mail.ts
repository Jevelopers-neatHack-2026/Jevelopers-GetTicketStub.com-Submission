import "server-only";
import { HttpError } from "./http";
import type { Mail } from "./templates";

const DEFAULT_FROM = "TicketStub <hello@getticketstub.com>";

const mask = (email: string) => email.replace(/^(.).*(@.*)$/, "$1***$2");

export interface SendResult {
  /** True when Resend accepted it. False when there is no key and the mail was only logged. */
  delivered: boolean;
}

/**
 * Sends through Resend over plain fetch. Without RESEND_API_KEY nothing is sent: the caller decides what
 * to log (a sign-in link in sandbox, nothing secret otherwise). Subjects and bodies are never logged here.
 */
export async function sendMail(to: string, mail: Mail, what: string): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    console.log(`[mail] no RESEND_API_KEY, not sent: ${what} to ${mask(to)}`);
    return { delivered: false };
  }
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM?.trim() || DEFAULT_FROM, to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    console.error(`[mail] resend unreachable: ${what}`);
    throw new HttpError(502, "mail_failed", "We couldn't send the email. Try again in a minute.");
  }
  if (!res.ok) {
    console.error(`[mail] resend refused (${res.status}): ${what}`);
    throw new HttpError(502, "mail_failed", "We couldn't send the email. Try again in a minute.");
  }
  return { delivered: true };
}
