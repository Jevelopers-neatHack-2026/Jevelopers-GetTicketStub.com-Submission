"use client";
import { useId, useState } from "react";
import { Field, PunchTabs, Rule, SandboxStrip, Stamp, Stamped, Switch } from "@/customer/desk/Desk";
import { StubView } from "@/customer/studio/stub/StubView";
import { haptic } from "@/customer/studio/feedback";
import { sharePath } from "@/customer/account/share";
import { getStub } from "@/customer/studio/store";
import { formatMoney, type Stub } from "@/customer/studio/types";
import { PageShell, CopyField, EmptyState, OnDesk, PaperLink, StampLink, TearAnchor, ui } from "@/customer/pages/ui";
import { SANDBOX_LABEL, addOrder, materialPrice, updateSeat } from "@/customer/pages/commerce";
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
    const path = await sharePath(gift);
    setGiftPath(wrap ? `${path}?gift=1&to=${encodeURIComponent(to)}` : path);
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
            <CopyField path={giftPath} label="Gift link" />
            <div className={ui.row}>
              <PaperLink href={giftPath}>Preview the gift</PaperLink>
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
              <textarea id={noteId} className={`${ui.input} ${s.note}`} value={note} maxLength={240} placeholder="Said what, to whom, about which night." onChange={(e) => setNote(e.target.value)} />
            </div>

            <Rule kind="perf" />

            <Switch checked={wrap} onChange={setWrap} hint="They tear it open to see the stub.">
              Wrap it
            </Switch>

            <Stamp type="submit" block>
              Send the gift
            </Stamp>
          </form>
        )}
      </div>
    </PageShell>
  );
}
