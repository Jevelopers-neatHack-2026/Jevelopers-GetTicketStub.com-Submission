"use client";
// A guest's own claim link from an organizer: their stub, already named. A magic link signs them in,
// then one tap puts the stub on their wall.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Stamp, Stamped, TearLink } from "@/customer/desk/Desk";
import { ApiError, api, type ClaimInfo } from "@/customer/account/api";
import { openSignIn } from "@/customer/account/signin";
import { useAccount } from "@/customer/account/useAccount";
import { StubView } from "@/customer/studio/stub/StubView";
import { haptic } from "@/customer/studio/feedback";
import { upsertStub } from "@/customer/studio/store";
import { LeavesMark, PageShell, FriendlyError, OnDesk, ui } from "@/customer/pages/ui";
import { formatDate } from "@/customer/pages/share";
import { useMounted } from "@/customer/pages/useMounted";
import s from "../../[set]/claim.module.css";

type Load = { state: "loading" } | { state: "ready"; info: ClaimInfo } | { state: "missing" } | { state: "offline" };

export default function GuestClaimClient({ token }: { token: string }) {
  const router = useRouter();
  const mounted = useMounted();
  const { status, account } = useAccount();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api
      .claimInfo(token)
      .then((info) => live && setLoad({ state: "ready", info }))
      .catch((e: ApiError) => live && setLoad({ state: e.status === 404 ? "missing" : "offline" }));
    return () => {
      live = false;
    };
  }, [token]);

  if (!mounted || load.state === "loading") return <PageShell>{null}</PageShell>;
  if (load.state === "missing") {
    return (
      <PageShell>
        <FriendlyError title="We couldn't find this claim link." body="The link may be cut short. Ask the organizer to send it again." />
      </PageShell>
    );
  }
  if (load.state === "offline") {
    return (
      <PageShell>
        <FriendlyError title="We can't open this claim link right now." body="We couldn't reach the server. Check your connection and open the link again." />
      </PageShell>
    );
  }

  const { info } = load;
  // the seat lives on the guest's row; show it on the stub if the server's copy doesn't carry it
  const stub = info.seat && !info.stub.event.seat ? { ...info.stub, event: { ...info.stub.event, seat: info.seat } } : info.stub;
  const e = stub.event;
  const meta = [formatDate(e.dateISO), e.venue, e.city].filter(Boolean).join(" · ");
  const first = info.guestName.split(/\s+/)[0] || info.guestName;

  async function claim() {
    setBusy(true);
    setError("");
    try {
      const res = await api.claim(token);
      upsertStub({ ...res.stub, torn: true });
      haptic([20]);
      setDone(true);
      setTimeout(() => router.push(`/wall?pinned=${encodeURIComponent(res.stub.id)}`), 900);
    } catch (err) {
      const status = (err as ApiError).status;
      setError(
        status === 409
          ? "This stub was claimed with a different email. Ask the organizer for a new link."
          : status === 410
            ? "This link has expired. Ask the organizer for a new one."
            : status === 401
              ? "Sign in first, so the stub has a wall to land on."
              : "We couldn't claim it just now. Try again in a moment.",
      );
      setBusy(false);
    }
  }

  const expired = info.expired;

  return (
    <PageShell right={<span className="desk-label">Guest claim</span>}>
      <div className={s.layout}>
        <div className={s.desk}>
          <OnDesk>
            <StubView stub={stub} size="md" tilt />
          </OnDesk>
          {info.seat ? <p className={s.seat}>Seat {info.seat}</p> : null}
        </div>

        <section className={s.panel} aria-labelledby="guest-h">
          <header className={s.head}>
            <p className="desk-label">Your stub from the organizer</p>
            <h1 id="guest-h" className={s.title}>
              {expired ? "This link has expired." : `Claim your stub, ${first}.`}
            </h1>
            <p className={s.lede}>{e.title}</p>
            {meta ? <p className={s.meta}>{meta}</p> : null}
          </header>

          {expired ? (
            <p className={ui.muted}>Ask the organizer to send you a new claim link.</p>
          ) : done ? (
            <div className={s.signed} role="status">
              <Stamped>Claimed</Stamped>
              <span>It&apos;s on your wall.</span>
            </div>
          ) : status === "loading" ? null : account ? (
            <div className={s.form}>
              <p className={ui.muted}>
                Signed in as <strong>{account.email}</strong>. Claiming puts this stub on your wall, on every device you sign in on.
              </p>
              <Stamp type="button" block disabled={busy} onClick={() => void claim()}>
                Claim my stub
                <LeavesMark />
              </Stamp>
              {info.claimed ? <p className={ui.muted}>Already claimed? Claiming again with the same email is fine.</p> : null}
              {error ? (
                <p className={ui.err} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <div className={s.form}>
              <p className={ui.muted}>
                {info.claimed ? "This stub is claimed. If it's yours, sign in with the same email." : "We'll email you a link, so this stub follows you to any phone or laptop. No password."}
              </p>
              <Stamp type="button" block onClick={() => openSignIn({ reason: "claim", returnTo: `/claim/g/${encodeURIComponent(token)}` })}>
                Email me a link
              </Stamp>
              <TearLink type="button" onClick={() => router.push("/")}>
                Make a stub of my own
                <LeavesMark />
              </TearLink>
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
