import type { Order } from "@/customer/pages/commerce";
import { appOrigin, notFound, route } from "@/server/http";
import { emailChangeMail, magicLinkMail, receiptMail, stubImageUrl, type LinkReason } from "@/server/templates";

// Dev only: the email HTML in a browser tab. `kind` is link | receipt | email, `reason` picks the link
// copy, and `text=1` shows the plain-text part. A 404 in production.
export const GET = route(async (req: Request) => {
  if (process.env.NODE_ENV === "production") throw notFound();
  const q = new URL(req.url).searchParams;
  const origin = appOrigin(req);
  const image = stubImageUrl(origin, q.get("share"));
  const sample: Order = {
    id: "ord_preview",
    mode: "sandbox",
    createdAt: new Date().toISOString(),
    stubIds: ["preview"],
    lines: [
      { title: "Night 2 of 3", material: "framed", finish: "foil", size: "framed", totalMinor: 9500 },
      { title: "Night 2 of 3", material: "card", finish: "matte", size: "classic", totalMinor: 3500 },
    ],
    totalMinor: 13000,
    currency: "USD",
    method: "card",
    email: "you@example.com",
  };
  const kind = q.get("kind");
  const reason = (["save", "checkout", "claim"] as const).find((r) => r === q.get("reason")) ?? "save";
  const mail =
    kind === "receipt"
      ? receiptMail(sample, `${origin}/wall`, image)
      : kind === "email"
        ? emailChangeMail(`${origin}/signin/confirm?token=preview`, image)
        : magicLinkMail(reason as LinkReason, `${origin}/signin/confirm?token=preview`, image);
  if (q.get("text") === "1") return new Response(`${mail.subject}\n\n${mail.text}`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  return new Response(mail.html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
});
