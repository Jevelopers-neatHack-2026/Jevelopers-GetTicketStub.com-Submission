"use client";
import Link from "next/link";
import { useState } from "react";
import { play, haptic } from "@/customer/studio/feedback";
import { getStub } from "@/customer/studio/store";
import { currentVersion, type Stub } from "@/customer/studio/types";
import { PageShell, QrPlaceholder, ui } from "@/customer/pages/ui";
import { absoluteUrl, formatDate, memoryPath } from "@/customer/pages/share";
import { useMounted } from "@/customer/pages/useMounted";
import s from "./wallet.module.css";

type Provider = "apple" | "google";

export default function WalletClient({ id }: { id: string }) {
  const mounted = useMounted();
  const [stub, setStub] = useState<Stub | null | undefined>(undefined);
  const [issued, setIssued] = useState<Provider | null>(null);

  if (mounted && stub === undefined) setStub(getStub(id) ?? null);

  if (!mounted || stub === undefined) return <PageShell back={{ href: "/wall", label: "Wall" }}>{null}</PageShell>;
  if (stub === null) {
    return (
      <PageShell back={{ href: "/wall", label: "Wall" }}>
        <div className={ui.error}>
          <h1 className={ui.h2}>We couldn&apos;t find this stub on this device.</h1>
          <Link className="btn btn-primary" href="/wall">
            Open your wall
          </Link>
        </div>
      </PageShell>
    );
  }

  const e = stub.event;
  const art = currentVersion(stub)?.art;
  const memUrl = absoluteUrl(memoryPath(stub));
  const friends = stub.personal.friends.length;

  function add(p: Provider) {
    setIssued(p);
    play("drop");
    haptic([20]);
  }

  return (
    <PageShell back={{ href: memoryPath(stub), label: "Back to your stub" }}>
      <div className={s.layout}>
        <section className={s.main} aria-labelledby="w-h">
          <h1 id="w-h" className={ui.h1}>
            Keep it in your wallet
          </h1>
          <p className={ui.muted}>Your stub as a pass. It updates when friends claim their seats.</p>

          <div className={s.pass} aria-label={`Wallet pass for ${e.title}`} role="group">
            <div className={s.passTop}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/favicon.svg" alt="" width={24} height={24} />
              <span className={s.passBrand}>TicketStub</span>
              <span className={s.passDate}>{formatDate(e.dateISO)}</span>
            </div>
            <div
              className={s.strip}
              style={art?.kind === "image" && art.src ? { backgroundImage: `url(${art.src})` } : undefined}
              aria-hidden="true"
            />
            <div className={s.passBody}>
              <p className={s.passLabel}>Event</p>
              <p className={s.passTitle}>{e.title}</p>
              <div className={s.passRow}>
                <div>
                  <p className={s.passLabel}>Venue</p>
                  <p>{[e.venue, e.city].filter(Boolean).join(", ") || "[VENUE]"}</p>
                </div>
                {e.seat ? (
                  <div>
                    <p className={s.passLabel}>Seat</p>
                    <p>{e.seat}</p>
                  </div>
                ) : null}
              </div>
              <div className={s.passQr}>
                <QrPlaceholder value={memUrl} />
                <p className={s.passSmall}>Opens your memory page</p>
              </div>
              <p className={s.passSmall}>
                Updated: {friends} {friends === 1 ? "friend" : "friends"} added
              </p>
            </div>
          </div>

          <div className={s.buttons}>
            <button type="button" className={`btn btn-block ${s.walletBtn}`} onClick={() => add("apple")}>
              Add to Apple Wallet
            </button>
            <button type="button" className={`btn btn-block ${s.walletBtn}`} onClick={() => add("google")}>
              Add to Google Wallet
            </button>
          </div>
          <div aria-live="polite">
            {issued ? (
              <div className={ui.card}>
                <p>
                  <strong>Simulated.</strong> In the live app, we&apos;d issue a signed {issued === "apple" ? "Apple Wallet" : "Google Wallet"} pass with this design. No
                  pass was issued in this demo.
                </p>
                <span className="provenance">simulated</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className={s.phone} aria-labelledby="phone-h">
          <h2 id="phone-h" className={ui.h2}>
            Send to your phone
          </h2>
          <QrPlaceholder value={absoluteUrl(`/wallet/${stub.id}`)} caption="Scan with your phone camera to add the pass there." />
          <p className={ui.muted}>Placeholder code for the demo.</p>
        </aside>
      </div>
    </PageShell>
  );
}
