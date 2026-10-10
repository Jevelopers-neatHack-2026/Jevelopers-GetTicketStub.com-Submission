"use client";
// The receipt's email, as part of the magic-link flow: signed in it is just stated; signed out it is the
// field, and after paying the same address is offered back as "Save to your wall".
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, PaperButton, Stamped, TearLink } from "@/customer/desk/Desk";
import { EMAIL_RE } from "./api";
import { type Placed } from "./orders";
import { openSignIn } from "./signin";
import { useAccount } from "./useAccount";
import s from "./account.module.css";

/** The address the receipt goes to: the account's when signed in, else what was typed (may be empty). */
export function useReceiptEmail() {
  const { status, account } = useAccount();
  const [typed, setTyped] = useState("");
  const email = account ? account.email : typed.trim();
  const problem = !account && email !== "" && !EMAIL_RE.test(email) ? "That email doesn't look right. Check it, or leave it empty." : "";
  return { status, signedIn: !!account, email, typed, setTyped, problem };
}

export function ReceiptField({ id, r, onChange }: { id: string; r: ReturnType<typeof useReceiptEmail>; onChange?: () => void }) {
  if (r.status === "loading") return null;
  if (r.signedIn) {
    return (
      <p className={s.lede}>
        Receipt goes to <strong className={s.addr}>{r.email}</strong>.
      </p>
    );
  }
  return (
    <Field
      id={id}
      type="email"
      label="Email for your receipt"
      hint="We'll send the receipt here. Use it again to save your wall. You can leave it empty in the sandbox."
      value={r.typed}
      autoComplete="email"
      onChange={(ev) => {
        r.setTyped(ev.target.value);
        onChange?.();
      }}
    />
  );
}

/** What replaces the Pay stamp once the order is in. Signed in, or with nobody to email, it walks on to the wall. */
export function AfterPay({ placed, email, signedIn }: { placed: Placed | null; email: string; signedIn: boolean }) {
  const router = useRouter();
  const offer = !signedIn && !!email && placed?.receipt === true;
  useEffect(() => {
    if (!placed || offer) return;
    const t = setTimeout(() => router.push(email ? "/wall?email=sent" : "/wall"), 900);
    return () => clearTimeout(t);
  }, [placed, offer, email, router]);
  return (
    <div className={s.after}>
      <Stamped>Ordered</Stamped>
      {!placed ? (
        <p className={s.small}>Placing your order.</p>
      ) : offer ? (
        <>
          <p className={s.lede}>
            Your receipt is on its way to <strong className={s.addr}>{email}</strong>. Save to your wall with the same address, so your stubs follow you to any phone or laptop.
          </p>
          <PaperButton type="button" block onClick={() => openSignIn({ reason: "checkout", returnTo: "/wall", email })}>
            Save to your wall
          </PaperButton>
          <TearLink type="button" onClick={() => router.push("/wall")}>
            Open your wall
          </TearLink>
        </>
      ) : (
        <p className={s.small}>Taking you to your wall.</p>
      )}
    </div>
  );
}
