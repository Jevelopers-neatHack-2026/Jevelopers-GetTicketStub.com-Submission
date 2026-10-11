"use client";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { FitBox } from "@/customer/pages/FitBox";
import { play, haptic } from "@/customer/studio/feedback";
import { NEATHACK, newStub } from "@/customer/studio/fixtures";
import { decodeStub, encodeStub, loadWall, upsertStub } from "@/customer/studio/store";
import type { Stub } from "@/customer/studio/types";
import { PageShell, FriendlyError, QrPlaceholder, ui } from "@/customer/pages/ui";
import { formatDate, isStub } from "@/customer/pages/share";
import { useMounted } from "@/customer/pages/useMounted";
import s from "./claim.module.css";

export default function ClaimClient({ set, from }: { set: string; from?: string }) {
  const router = useRouter();
  const mounted = useMounted();
  const nameId = useId();
  const source = useMemo(() => {
    if (!mounted || !from) return undefined;
    const d = decodeStub(from);
    return isStub(d) ? d : undefined;
  }, [mounted, from]);
  const event = set === "neathack" ? NEATHACK : source?.event;

  const [signIn, setSignIn] = useState<"google" | "apple" | "skip" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState(false);
  const here = mounted ? window.location.href : "";
  const alreadyInSet = useMemo(() => (mounted ? loadWall().filter((x) => x.setId === set).length : 0), [mounted, set]);

  // Seat numbers: the sender's list of friends defines the set size when we have it.
  const friends = source?.personal.friends ?? [];
  const total = friends.length ? friends.length + 1 : null;
  const openIdx = friends.findIndex((f) => !f.claimed);
  const seatNo = total ? (openIdx >= 0 ? openIdx + 2 : total) : alreadyInSet + 1;
  const seatLabel = `Seat ${seatNo} of ${total ?? "[N]"}`;

  const preview = useMemo<Stub | null>(() => {
    if (!event) return null;
    const st = newStub(event, `preview-${set}`);
    if (source) {
      st.versions = source.versions;
      st.currentVersionId = source.currentVersionId;
      st.personal = { ...source.personal, friends: [] };
    }
    st.personal = { ...st.personal, friends: [{ name: name.trim() || "Your name", seat: seatLabel, claimed: true }] };
    st.setId = set;
    st.wallAngle = 0;
    return st;
  }, [event, source, set, name, seatLabel]);

  if (!mounted) return <PageShell>{null}</PageShell>;
  if (!event || !preview) {
    return (
      <PageShell>
        <FriendlyError title="We couldn't find this set." body="The claim link may be cut short. Ask the person who sent it for the link again." />
      </PageShell>
    );
  }

  function choose(p: "google" | "apple" | "skip") {
    setSignIn(p);
    if (p !== "skip" && !name) setName("Judge");
    play("tick");
  }

  function claim() {
    const n = name.trim();
    if (!n) {
      setError("Add your name so it prints on your stub.");
      return;
    }
    setClaiming(true);
    const st = newStub(event!);
    if (source) {
      st.versions = source.versions;
      st.currentVersionId = source.currentVersionId;
      st.personal = { ...source.personal, note: undefined };
    }
    const others = friends.filter((_, i) => i !== openIdx).map((f) => ({ ...f }));
    st.personal = { ...st.personal, friends: [{ name: n, seat: seatLabel, claimed: true }, ...others] };
    st.setId = set;
    st.torn = true;
    upsertStub(st);
    play("stamp");
    haptic([20]);
    router.push(`/s/${encodeStub(st)}`);
  }

  const setTitle = set === "neathack" ? "neatHack 2026 · matching set" : `${event.title} · matching set`;
  const meta = [formatDate(event.dateISO), event.venue, event.city].filter(Boolean).join(" · ");

  return (
    <PageShell>
      <div className={s.layout}>
        <aside className={s.qrCol} aria-label="Claim on your phone">
          <QrPlaceholder value={here || set} caption="Scan to claim on your phone" />
          <p className={ui.muted}>Placeholder code for the demo. Open this link on your phone instead.</p>
        </aside>

        <section className={s.panel} aria-labelledby="claim-h">
          <p className="label">{setTitle}</p>
          <h1 id="claim-h" className={ui.h1}>
            Claim your stub from {event.title}.
          </h1>
          {meta ? <p className={ui.muted}>{meta}</p> : null}
          <span className="chip num">{seatLabel}</span>

          <div className={s.preview}>
            <FitBox>
              <StubView stub={preview} size="md" tilt />
            </FitBox>
          </div>

          {!signIn ? (
            <div className={ui.stack}>
              <button type="button" className="btn btn-primary btn-block" onClick={() => choose("apple")}>
                Continue with Apple
              </button>
              <button type="button" className="btn btn-block" onClick={() => choose("google")}>
                Continue with Google
              </button>
              <button type="button" className={`btn btn-quiet btn-block`} onClick={() => choose("skip")}>
                Just add my name
              </button>
              <p className={ui.muted}>Sign-in is simulated in this demo.</p>
            </div>
          ) : (
            <form
              className={ui.stack}
              onSubmit={(ev) => {
                ev.preventDefault();
                claim();
              }}
            >
              {signIn !== "skip" ? (
                <p className={s.signedIn} role="status">
                  Signed in with {signIn === "apple" ? "Apple" : "Google"}. Sign-in is simulated in this demo.
                </p>
              ) : null}
              <div className={ui.field}>
                <label htmlFor={nameId} className={ui.fieldLabel}>
                  Name on your stub
                </label>
                <input
                  id={nameId}
                  className={ui.input}
                  value={name}
                  maxLength={32}
                  autoComplete="name"
                  onChange={(e) => {
                    setName(e.target.value);
                    setError("");
                  }}
                  aria-invalid={!!error}
                  aria-describedby={error ? `${nameId}-err` : undefined}
                />
                {error ? (
                  <p id={`${nameId}-err`} className={s.err}>
                    {error}
                  </p>
                ) : null}
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={claiming}>
                Claim my stub
              </button>
            </form>
          )}
        </section>
      </div>
    </PageShell>
  );
}
