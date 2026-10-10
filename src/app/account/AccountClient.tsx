"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, MarkLegend, PaperButton, PaperSheet, Rule, SourceMark, Stamp, Stamped, TearLink } from "@/customer/desk/Desk";
import { ApiError, EMAIL_RE, api } from "@/customer/account/api";
import { openSignIn } from "@/customer/account/signin";
import { refreshAccount, useAccount } from "@/customer/account/useAccount";
import { MATERIALS, formatMoney } from "@/customer/studio/types";
import type { Order } from "@/customer/pages/commerce";
import { PageShell } from "@/customer/pages/ui";
import { useMounted } from "@/customer/pages/useMounted";
import s from "./account.module.css";

const dateOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const materialLabel = (id: string) => MATERIALS.find((m) => m.id === id)?.label ?? id;

export default function AccountClient() {
  const router = useRouter();
  const mounted = useMounted();
  const { status, account, signOut } = useAccount();
  const [orders, setOrders] = useState<Order[] | null | "error">(null);
  const [sheet, setSheet] = useState<"email" | "delete" | null>(null);
  // /account?email=changed|taken is where the emailed confirmation link lands
  const [note] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("email")));

  useEffect(() => {
    if (status !== "in") return;
    let live = true;
    api
      .orders()
      .then((o) => live && setOrders(o))
      .catch(() => live && setOrders("error"));
    return () => {
      live = false;
    };
  }, [status]);

  useEffect(() => {
    if (note === "changed") void refreshAccount();
  }, [note]);

  if (!mounted || status === "loading") return <PageShell title="Your account">{null}</PageShell>;

  if (!account) {
    return (
      <PageShell title="Your account">
        <div className={s.wrap}>
          <h1 className={s.title}>Save your wall.</h1>
          <p className={s.lede}>We&apos;ll email you a link, so your stubs and orders follow you to any phone or laptop. No password.</p>
          <Stamp type="button" onClick={() => openSignIn({ reason: "save", returnTo: "/account" })}>
            Email me a link
          </Stamp>
          <p className={s.muted}>
            <Link className={s.plain} href="/privacy">
              Privacy
            </Link>{" "}
            ·{" "}
            <Link className={s.plain} href="/terms">
              Terms
            </Link>
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Your account">
      <div className={s.wrap}>
        <header className={s.head}>
          <p className="desk-label">Signed in</p>
          <h1 className={s.title}>Your account</h1>
        </header>
        {note === "changed" ? (
          <p className={s.notice} role="status">
            <Stamped>Changed</Stamped> Your email is updated.
          </p>
        ) : note === "taken" ? (
          <p className={s.notice} role="alert">
            That email already has an account, so we kept your current one. Use another address, or sign in with that one.
          </p>
        ) : null}

        <section className={s.block} aria-labelledby="acct-email">
          <h2 id="acct-email" className="desk-label">
            Email
          </h2>
          <p className={s.email}>{account.email}</p>
          <div>
            <PaperButton type="button" onClick={() => setSheet("email")}>
              Change email
            </PaperButton>
          </div>
        </section>

        <Rule kind="perf" />

        <section className={s.block} aria-labelledby="acct-orders">
          <h2 id="acct-orders" className="desk-label">
            Your orders
          </h2>
          {orders === null ? (
            <p className={s.muted}>Loading your orders.</p>
          ) : orders === "error" ? (
            <p className={s.muted}>We couldn&apos;t load your orders. Try again in a moment.</p>
          ) : orders.length === 0 ? (
            <p className={s.muted}>No orders yet. When you print a stub, the receipt lands here.</p>
          ) : (
            <ul className={s.orders}>
              {orders.map((o) => (
                <li key={o.id} className={s.order}>
                  <p className={s.orderHead}>
                    <span className={s.num}>{dateOf(o.createdAt)}</span>
                    <span className={s.num}>
                      {formatMoney(o.totalMinor)}
                      <SourceMark p="sandbox" />
                    </span>
                  </p>
                  <ul className={s.lines}>
                    {o.lines.map((l, i) => (
                      <li key={i}>
                        {l.title}{" "}
                        <span className={s.muted}>
                          · {materialLabel(l.material)}, {l.finish}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {Array.isArray(orders) && orders.length > 0 ? <MarkLegend marks={["sandbox"]} /> : null}
        </section>

        <Rule kind="perf" />

        <p className={s.muted}>
          <Link className={s.plain} href="/privacy">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link className={s.plain} href="/terms">
            Terms
          </Link>
        </p>

        <div className={s.foot}>
          <TearLink
            type="button"
            onClick={async () => {
              await signOut();
              router.push("/wall");
            }}
          >
            Sign out
          </TearLink>
          <button type="button" className={s.danger} onClick={() => setSheet("delete")}>
            Delete my account
          </button>
        </div>
      </div>

      <PaperSheet open={sheet === "email"} onClose={() => setSheet(null)} title="Change email">
        {sheet === "email" ? <ChangeEmail /> : null}
      </PaperSheet>
      <PaperSheet open={sheet === "delete"} onClose={() => setSheet(null)} title="Delete your account">
        {sheet === "delete" ? <DeleteAccount email={account.email} onDone={() => router.push("/wall")} /> : null}
      </PaperSheet>
    </PageShell>
  );
}

function ChangeEmail() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ email: string; devLink?: string } | null>(null);
  async function send() {
    const to = email.trim();
    if (!EMAIL_RE.test(to)) return setError("That email doesn't look right. Check it and try again.");
    setBusy(true);
    setError("");
    try {
      const r = await api.changeEmail(to);
      setSent({ email: to, devLink: r.devLink });
    } catch (e) {
      const err = e as ApiError;
      setError(
        err.status === 409
          ? "That email already has an account."
          : err.code === "disposable_email"
            ? "That looks like a throwaway address. Use an email you keep."
            : "We couldn't send the link. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (sent) {
    return (
      <div className={s.sheetBody}>
        <p className={s.lede} role="status">
          Check your email. We sent a link to <strong>{sent.email}</strong>. Your email changes when you open it.
        </p>
        {sent.devLink ? (
          <p className={s.muted}>
            Sandbox mail
            <SourceMark p="sandbox" />: nothing was emailed.{" "}
            <a className={s.plain} href={sent.devLink}>
              Open the link
            </a>
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <form
      className={s.sheetBody}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <p className={s.lede}>We&apos;ll email a link to the new address. Your email changes when you open it.</p>
      <Field
        id="acct-new"
        type="email"
        label="New email"
        autoComplete="email"
        autoFocus
        value={email}
        hint={error || undefined}
        aria-invalid={!!error}
        onChange={(e) => {
          setEmail(e.target.value);
          setError("");
        }}
      />
      <Stamp type="submit" block disabled={busy}>
        {busy ? "Sending" : "Email me a link"}
      </Stamp>
    </form>
  );
}

function DeleteAccount({ email, onDone }: { email: string; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const match = typed.trim().toLowerCase() === email.toLowerCase();
  async function go() {
    setBusy(true);
    setError("");
    try {
      await api.deleteAccount(typed.trim());
      await refreshAccount();
      onDone();
    } catch {
      setError("We couldn't delete the account. Try again in a moment.");
      setBusy(false);
    }
  }
  return (
    <form
      className={s.sheetBody}
      onSubmit={(e) => {
        e.preventDefault();
        if (match) void go();
      }}
    >
      <p className={s.lede}>This removes your wall, share links and organizer events from our server, and anonymises your receipts. The stubs on this device stay here.</p>
      <Field id="acct-confirm" type="email" label="Type your email to confirm" autoComplete="off" value={typed} hint={error || email} onChange={(e) => setTyped(e.target.value)} />
      <Stamp type="submit" block disabled={!match || busy}>
        {busy ? "Deleting" : "Delete my account"}
      </Stamp>
    </form>
  );
}
