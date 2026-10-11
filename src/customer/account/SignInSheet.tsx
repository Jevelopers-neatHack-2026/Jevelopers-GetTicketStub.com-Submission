"use client";
// The one way in: an email, a link. The sheet is a PaperSheet with a Field and a Stamp; once the link is
// sent it shows the address, and (only when the server says it is sandboxed) a clearly labelled link to open.
import Link from "next/link";
import { useState } from "react";
import { Field, MarkLegend, PaperSheet, Rule, SourceMark, Stamp, TearLink } from "@/customer/desk/Desk";
import d from "@/customer/desk/Desk.module.css";
import { LeavesMark } from "@/customer/pages/ui";
import { play } from "@/customer/studio/feedback";
import { ApiError, EMAIL_RE, api, type LinkReason } from "./api";
import { SAVING_OFF_LINE, useSavingOff } from "./saving";
import { closeSignIn, updateSignIn, type SignInRequest } from "./signin";
import s from "./account.module.css";

const COPY: Record<LinkReason, { title: string; lede: string }> = {
  save: { title: "Save to your wall", lede: "We'll email you a link, so your stubs follow you to any phone or laptop." },
  checkout: { title: "Save to your wall", lede: "We'll email you a link, so your order and your stubs follow you to any phone or laptop." },
  claim: { title: "Save this stub", lede: "We'll email you a link, so the stub you claim follows you to any phone or laptop." },
};

export function SignInSheet({ request }: { request: SignInRequest | null }) {
  const off = useSavingOff();
  return (
    <PaperSheet open={!!request} onClose={closeSignIn} title={request ? (off ? "Saving is off" : request.sent ? "Check your email" : (request.title ?? COPY[request.reason].title)) : ""}>
      {request ? <Body key={`${request.reason}-${request.returnTo ?? ""}`} request={request} /> : null}
    </PaperSheet>
  );
}

function Body({ request }: { request: SignInRequest }) {
  const off = useSavingOff();
  if (off) {
    // No writable storage on this preview: say so calmly, offer nothing to fill in.
    return (
      <div className={s.body}>
        <p className={s.lede} role="status">
          {SAVING_OFF_LINE}
        </p>
        <TearLink type="button" onClick={closeSignIn}>
          Close
        </TearLink>
      </div>
    );
  }
  return <Form request={request} />;
}

function Form({ request }: { request: SignInRequest }) {
  const copy = { ...COPY[request.reason], ...(request.lede ? { lede: request.lede } : {}) };
  const [email, setEmail] = useState(request.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sent = request.sent;

  async function send() {
    const to = email.trim();
    if (!EMAIL_RE.test(to)) {
      setError("That email doesn't look right. Check it and try again.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.link(to, request.reason, request.returnTo);
      play("success", { emphasis: "subtle" });
      updateSignIn({ sent: { email: to, devLink: res.devLink } });
    } catch (e) {
      const err = e as ApiError;
      setError(
        err.code === "disposable_email"
          ? "That looks like a throwaway address. Use an email you keep, so we can find your wall again."
          : err.code === "mail_unavailable"
          ? "We can't send email right now. Your stubs are safe on this device. Try again later."
          : err.status === 429
          ? "That's a lot of links. Give it a few minutes, then try again."
          : err.code === "network" || err.code === "unavailable"
            ? "We can't reach the server, so we can't send a link right now. Your stubs are safe on this device."
            : "We couldn't send the link. Check the address and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className={s.body}>
        <p className={s.lede} role="status">
          We sent a link to <strong className={s.addr}>{sent.email}</strong>. Open it on this device to save your wall. It works once and lasts 15 minutes.
        </p>
        {sent.devLink ? (
          <div className={s.sandbox}>
            <p className={s.sandboxNote}>
              <span className="desk-label">Sandbox mail</span>
              <SourceMark p="sandbox" />
            </p>
            <p className={s.small}>No mail service is connected here, so nothing was emailed. Use this button instead of the inbox.</p>
            {/* a full navigation: the link signs you in on the server, then sends you on */}
            <a href={sent.devLink} className={`${d.paper} ${s.open}`} onClick={() => play("tap", { emphasis: "subtle" })}>
              Open the link
              <LeavesMark />
            </a>
            <MarkLegend marks={["sandbox"]} />
          </div>
        ) : null}
        <Rule kind="perf" />
        <div className={s.row}>
          <TearLink
            type="button"
            onClick={() => {
              updateSignIn({ sent: undefined, email: sent.email });
              setError("");
            }}
          >
            Use a different email
          </TearLink>
          <TearLink type="button" onClick={closeSignIn}>
            Close
          </TearLink>
        </div>
      </div>
    );
  }

  return (
    <form
      className={s.body}
      onSubmit={(ev) => {
        ev.preventDefault();
        void send();
      }}
      noValidate
    >
      <p className={s.lede}>{copy.lede}</p>
      <Field
        id="signin-email"
        type="email"
        label="Your email"
        hint={error ? undefined : "No password. The link works once."}
        value={email}
        autoComplete="email"
        inputMode="email"
        autoFocus
        onChange={(ev) => {
          setEmail(ev.target.value);
          setError("");
        }}
        aria-invalid={!!error}
      />
      {error ? (
        <p className={s.err} role="alert">
          {error}
        </p>
      ) : null}
      <Stamp type="submit" block disabled={busy}>
        {busy ? "Sending" : "Email me a link"}
      </Stamp>
      <TearLink type="button" onClick={closeSignIn}>
        Not now
      </TearLink>
      <p className={s.small}>
        We keep your email to sign you in. Read the{" "}
        <Link href="/privacy" className={s.plain} onClick={closeSignIn}>
          privacy note
        </Link>{" "}
        and the{" "}
        <Link href="/terms" className={s.plain} onClick={closeSignIn}>
          terms
        </Link>
        .
      </p>
    </form>
  );
}
