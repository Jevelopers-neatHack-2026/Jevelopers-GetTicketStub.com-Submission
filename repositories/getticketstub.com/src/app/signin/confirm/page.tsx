import type { Metadata } from "next";
import { Stamp } from "@/customer/desk/Desk";
import { PageShell, StampLink } from "@/customer/pages/ui";
import { lookupLink } from "@/server/confirm";
import s from "./confirm.module.css";

// The page an emailed link opens. Looking at it never uses the link up (mail scanners fetch links);
// only the tap on the stamp does, as a plain form post to /api/auth/confirm.
// Keep the token path/query out of Referer while preserving Origin on the native form POST.
// no-referrer makes browsers send Origin: null, which the confirmation endpoint must reject.
export const metadata: Metadata = { title: "Sign in · TicketStub", robots: { index: false, follow: false }, referrer: "strict-origin" };

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const found = await lookupLink(token);

  if (!found.valid) {
    return (
      <PageShell narrow>
        <section className={s.sheet} aria-labelledby="confirm-h">
          <p className="desk-label">Sign-in link</p>
          <h1 id="confirm-h" className={s.title}>
            This link has expired.
          </h1>
          <p className={s.lede}>Links work once and last 15 minutes. Send yourself a new one and you&rsquo;re in.</p>
          <StampLink href="/wall?signin=expired">Send a new link</StampLink>
        </section>
      </PageShell>
    );
  }

  const email = found.kind === "email";
  return (
    <PageShell narrow>
      <section className={s.sheet} aria-labelledby="confirm-h">
        <p className="desk-label">{email ? "New email" : "Sign-in link"}</p>
        <h1 id="confirm-h" className={s.title}>
          {email ? "One tap makes this your email." : "One tap and you’re in."}
        </h1>
        <p className={s.lede}>
          We sent this to <span className={s.address}>{found.maskedEmail}</span>. Tap the stamp to finish.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={s.stub} src={`/api/stub-image/${found.shareToken ?? "brand"}`} width={480} height={200} alt={found.shareToken ? "Your stub" : "A TicketStub ticket stub"} />
        <form method="post" action="/api/auth/confirm" className={s.form}>
          <input type="hidden" name="token" value={token} />
          <Stamp type="submit" block>
            {email ? "Confirm your email" : "Sign in to TicketStub"}
          </Stamp>
        </form>
      </section>
    </PageShell>
  );
}
