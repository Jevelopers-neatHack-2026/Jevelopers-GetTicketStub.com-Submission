"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { play, haptic } from "@/customer/studio/feedback";
import { encodeStub, getStub } from "@/customer/studio/store";
import { formatMoney, type Stub } from "@/customer/studio/types";
import { PageShell, CopyField, SandboxBadge, ui } from "@/customer/pages/ui";
import { addOrder, materialPrice, updateSeat } from "@/customer/pages/commerce";
import { useMounted, randomId } from "@/customer/pages/useMounted";
import s from "./gift.module.css";

type Delivery = "link" | "print";

export default function GiftClient({ id, forName, cartItem, seatIndex }: { id: string; forName?: string; cartItem?: string; seatIndex?: number }) {
  const mounted = useMounted();
  const nameId = useId();
  const noteId = useId();
  const [stub, setStub] = useState<Stub | null | undefined>(undefined);
  const [name, setName] = useState(forName ?? "");
  const [delivery, setDelivery] = useState<Delivery>("link");
  const [note, setNote] = useState("");
  const [wrap, setWrap] = useState(true);
  const [error, setError] = useState("");
  const [giftPath, setGiftPath] = useState<string | null>(null);

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

  const printPrice = materialPrice("print");

  function send() {
    if (!stub) return;
    const to = name.trim();
    if (!to) {
      setError("Add who it's for so we can put their name on it.");
      return;
    }
    // The gift is its own copy: a new id, so the recipient sees a visitor page, not the sender's owner tools.
    const gift: Stub = {
      ...stub,
      id: `${stub.id}-g${randomId(4)}`,
      setId: stub.setId ?? stub.id,
      photos: [],
      personal: { ...stub.personal, note: note.trim() || stub.personal.note },
    };
    if (delivery === "print") {
      addOrder({ stubIds: [gift.id], lines: [{ title: `Gift for ${to}: ${stub.event.title}`, material: "print", finish: stub.finish, size: "classic", totalMinor: printPrice }], totalMinor: printPrice, method: "gift-print" });
    }
    if (cartItem && seatIndex !== undefined) updateSeat(cartItem, seatIndex, { decision: "gift", name: to });
    const token = encodeStub(gift);
    setGiftPath(wrap ? `/s/${token}?gift=1&to=${encodeURIComponent(to)}` : `/s/${token}`);
    play("stamp");
    haptic([18, 40, 28]);
  }

  return (
    <PageShell back={{ href: cartItem ? "/cart" : "/wall", label: cartItem ? "Cart" : "Wall" }} narrow>
      <div className={s.wrap}>
        <h1 className={ui.h1}>Send it as a gift</h1>
        <div className={s.preview}>
          <StubView stub={stub} size="sm" />
        </div>

        {giftPath ? (
          <section className={ui.card} aria-labelledby="sent-h" role="status">
            <h2 id="sent-h" className={ui.h2}>
              Your gift for {name.trim()} is ready.
            </h2>
            <p className={ui.muted}>
              Send them this link.{wrap ? " They tear it open to see the stub." : ""}
              {delivery === "print" ? " The print ships in the sandbox; no real order was placed." : ""}
            </p>
            <CopyField path={giftPath} label="Gift link" />
            <div className={ui.row}>
              <Link className="btn" href={giftPath}>
                Preview the gift
              </Link>
              <Link className="btn btn-quiet" href={cartItem ? "/cart" : "/wall"}>
                {cartItem ? "Back to your cart" : "Back to your wall"}
              </Link>
            </div>
          </section>
        ) : (
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className={ui.field}>
              <label htmlFor={nameId} className={ui.fieldLabel}>
                Who is it for?
              </label>
              <input
                id={nameId}
                className={ui.input}
                value={name}
                maxLength={32}
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

            <fieldset className={s.fieldset}>
              <legend className="label">Delivery</legend>
              <label className={s.option}>
                <input type="radio" name="delivery" checked={delivery === "link"} onChange={() => setDelivery("link")} />
                <strong>Send digitally by link</strong>
                <span>Free. They open it on their phone.</span>
              </label>
              <label className={s.option}>
                <input type="radio" name="delivery" checked={delivery === "print"} onChange={() => setDelivery("print")} />
                <strong>Ship a print · {formatMoney(printPrice)}</strong>
                <span>
                  Classic stub, 2 × 5.5 in. <SandboxBadge />
                </span>
              </label>
            </fieldset>

            <div className={ui.field}>
              <label htmlFor={noteId} className={ui.fieldLabel}>
                Gift note <span className={ui.muted}>(optional)</span>
              </label>
              <textarea id={noteId} className={ui.input} value={note} maxLength={240} onChange={(e) => setNote(e.target.value)} />
            </div>

            <div className={s.toggleRow}>
              <span id="wrap-l">
                <strong>Wrap it</strong>
                <span className={ui.muted}> · they tear it open</span>
              </span>
              <button type="button" role="switch" aria-checked={wrap} aria-labelledby="wrap-l" className={s.switch} onClick={() => setWrap((w) => !w)}>
                <span className={s.knob} />
              </button>
            </div>

            <button type="submit" className="btn btn-primary btn-block">
              Send the gift
            </button>
          </form>
        )}
      </div>
    </PageShell>
  );
}
