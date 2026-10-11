"use client";
import { useId, useState } from "react";
import { Field, PunchTabs, Rule, SandboxStrip, Stamp, Stamped, Switch, TearLink } from "@/customer/desk/Desk";
import { StubView } from "@/customer/studio/stub/StubView";
import { haptic } from "@/customer/studio/feedback";
import { ApiError, api } from "@/customer/account/api";
import { messageForError } from "@/customer/feedback-messages/messages";
import { ProgressNote, useProgress } from "@/customer/feedback-messages/progress";
import { sharePath } from "@/customer/account/share";
import { getStub } from "@/customer/studio/store";
import { formatMoney, type Stub } from "@/customer/studio/types";
import { PageShell, CopyField, EmptyState, OnDesk, PaperLink, StampLink, TearAnchor, ui } from "@/customer/pages/ui";
import { OrderBlocked, SANDBOX_LABEL, addOrder, materialPrice, updateSeat } from "@/customer/pages/commerce";
import { useMounted, randomId } from "@/customer/pages/useMounted";
import s from "./gift.module.css";

type Delivery = "link" | "print";

export default function GiftClient({ id, forName, cartItem, seatIndex }: { id: string; forName?: string; cartItem?: string; seatIndex?: number }) {
  const mounted = useMounted();
  const noteId = useId();
  const [stub, setStub] = useState<Stub | null | undefined>(undefined);
  const [name, setName] = useState(forName ?? "");
  const [delivery, setDelivery] = useState<Delivery>("link");
  const [note, setNote] = useState("");
  const [wrap, setWrap] = useState(true);
  const [error, setError] = useState("");
  const [giftPath, setGiftPath] = useState<string | null>(null);
  const [giftToken, setGiftToken] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const progress = useProgress();

  if (mounted && stub === undefined) setStub(getStub(id) ?? null);

  if (!mounted || stub === undefined) return <PageShell back={{ href: "/wall", label: "Wall" }}>{null}</PageShell>;
  if (stub === null) {
    return (
      <PageShell back={{ href: "/wall", label: "Wall" }}>
        <EmptyState kind="stub" title="This stub isn't on this device." body="A gift starts from a stub you made here. Open your wall and pick the one to give.">
          <StampLink href="/wall">Open your wall</StampLink>
        </EmptyState>
      </PageShell>
    );
  }

  const printPrice = materialPrice("print");
  const options = [
    { value: "link" as const, label: "By link", sub: "Free" },
    { value: "print" as const, label: "Ship a print", sub: formatMoney(printPrice) },
  ];

  async function send() {
    if (!stub) return;
    const to = name.trim();
    if (!to) {
      setError("Add who it's for so their name goes on it.");
      return;
    }
    // The gift is its own copy: a new id, so the recipient sees a visitor page, not the sender's owner tools.
    // The message is not part of it: it goes to the gift API and rides only on the gift's own link.
    const gift: Stub = {
      ...stub,
      id: `${stub.id}-g${randomId(4)}`,
      setId: stub.setId ?? stub.id,
      photos: [],
    };
    const message = note.trim();
    if (delivery === "print") {
      try {
        addOrder({ stubIds: [gift.id], lines: [{ title: `Gift for ${to}: ${stub.event.title}`, material: "print", finish: stub.finish, size: "classic", totalMinor: printPrice }], totalMinor: printPrice, method: "gift-print" });
      } catch (e) {
        // live mode refuses print variants no supplier has confirmed yet (capabilities.ts)
        if (e instanceof OrderBlocked) {
          setError("Printed gifts aren't orderable yet. Send it as a link instead.");
          return;
        }
        throw e;
      }
    }
    if (cartItem && seatIndex !== undefined) updateSeat(cartItem, seatIndex, { decision: "gift", name: to });
    // The server half: share the copy, then attach the note. Only real states are shown (sending, still working, failed).
    const made = await progress.run(async () => {
      const path = await sharePath(gift);
      if (/^\/s\/[\w-]+$/.test(path)) {
        try {
          const g = await api.createGift(gift.id, to, message);
          return { token: g.giftToken as string | null, link: wrap ? g.sharePath : `${g.sharePath}&wrap=0` };
        } catch (e) {
          if (message) throw e; // the note can't travel without the server: say so rather than send a link without it
          return { token: null, link: wrap ? `${path}?gift=1&to=${encodeURIComponent(to)}` : path };
        }
      }
      if (message) throw new ApiError("unavailable", "offline");
      return { token: null, link: wrap ? `${path}?gift=1&to=${encodeURIComponent(to)}` : path };
    });
    if (!made) return;
    progress.reset();
    setGiftToken(made.token);
    setRevoked(false);
    setGiftPath(made.link);
    haptic([18, 40, 28]);
  }

  const backHref = cartItem ? "/cart" : "/wall";

  return (
    <PageShell back={{ href: backHref, label: cartItem ? "Cart" : "Wall" }} narrow>
      <SandboxStrip>{SANDBOX_LABEL}</SandboxStrip>
      <div className={s.wrap}>
        <header className={s.head}>
          <p className="desk-label">{stub.event.title}</p>
          <h1 className={s.title}>{giftPath ? `Your gift for ${name.trim()} is ready.` : "Give it to someone."}</h1>
        </header>

        <OnDesk>
          <StubView stub={stub} size="sm" tilt />
        </OnDesk>

        {giftPath ? (
          <section className={ui.card} aria-labelledby="sent-h" role="status">
            <div>
              <Stamped>Sent</Stamped>
            </div>
            <h2 id="sent-h" className={ui.h3}>
              Send them this link.
            </h2>
            <p className={ui.muted}>
              {wrap ? "They tear it open to see the stub." : "They'll see the stub as soon as they open it."}
              {delivery === "print" ? " The print ships in the sandbox; no real order was placed." : ""}
            </p>
            {revoked ? (
              <p className={ui.status} role="status">
                Gift link stopped. The message is deleted and the link no longer works.
              </p>
            ) : (
              <>
                <CopyField path={giftPath} label="Gift link" />
                {giftToken ? (
                  <TearLink
                    type="button"
                    onClick={async () => {
                      try {
                        await api.revokeGift(giftToken);
                        setRevoked(true);
                      } catch (e) {
                        setError(messageForError(e).message);
                      }
                    }}
                  >
                    Stop this gift link
                  </TearLink>
                ) : null}
                {error ? <p className={ui.status}>{error}</p> : null}
              </>
            )}
            <div className={ui.row}>
              {revoked ? null : <PaperLink href={giftPath}>Preview the gift</PaperLink>}
              <TearAnchor href={backHref}>{cartItem ? "Back to your cart" : "Back to your wall"}</TearAnchor>
            </div>
          </section>
        ) : (
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Field
              id="gift-for"
              label="Who is it for?"
              placeholder="Their name"
              value={name}
              maxLength={32}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              aria-invalid={!!error}
              hint={error || undefined}
            />

            <div className={s.group}>
              <span className="desk-label">Delivery</span>
              <PunchTabs label="Delivery" options={options} value={delivery} onChange={setDelivery} />
              <p className={ui.status}>{delivery === "link" ? "They open it on their phone." : "Classic stub, 2 × 5.5 in, shipped to them. They get the link too."}</p>
            </div>

            <div className={s.group}>
              <label htmlFor={noteId} className="desk-label">
                Gift note, if you like
              </label>
              <textarea id={noteId} className={`${ui.input} ${s.note}`} value={note} maxLength={280} placeholder="Said what, to whom, about which night." onChange={(e) => setNote(e.target.value)} />
              <p className={ui.status}>Only the person you send this link to sees your message.</p>
            </div>

            <Rule kind="perf" />

            <Switch checked={wrap} onChange={setWrap} hint="They tear it open to see the stub.">
              Wrap it
            </Switch>

            <ProgressNote state={progress.state} labels={{ sending: "Making your gift link" }} onRetry={() => void send()} />
            <Stamp type="submit" block disabled={progress.busy}>
              {progress.busy ? "Sending" : "Send the gift"}
            </Stamp>
          </form>
        )}
      </div>
    </PageShell>
  );
}
