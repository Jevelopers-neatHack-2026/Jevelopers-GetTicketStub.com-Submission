"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MarkLegend, PaperButton, Rule, FinishSwatches, PunchTabs, SandboxStrip, SourceMark, Stamp, TearLink, type FinishValue } from "@/customer/desk/Desk";
import { StubView } from "@/customer/studio/stub/StubView";
import { MaterialFrame } from "@/customer/studio/editor/MaterialFrame";
import { holoAllowed, setFinish as applyFinish, setMaterial as applyMaterial } from "@/customer/studio/editor/ops";
import { haptic } from "@/customer/studio/feedback";
import { getStub, upsertStub } from "@/customer/studio/store";
import { MATERIALS, formatMoney, type Material, type Stub } from "@/customer/studio/types";
import { LeavesMark, PageShell, EmptyState, OnDesk, StampLink, ui } from "@/customer/pages/ui";
import { formatDate } from "@/customer/pages/share";
import { AfterPay, ReceiptField, useReceiptEmail } from "@/customer/account/Receipt";
import { placeOrder, type Placed } from "@/customer/account/orders";
import { FINISHES, SANDBOX_LABEL, SIZE_LABEL, addToCart, cartItemFromStub, quote, sizesFor, defaultSize, type PrintSize } from "@/customer/pages/commerce";
import { useMounted, nowMs } from "@/customer/pages/useMounted";
import s from "./checkout.module.css";

const MATERIAL_OPTIONS = MATERIALS.map((m) => ({ value: m.id, label: m.label, sub: formatMoney(m.priceMinor) }));

/** "Classic stub · 2 × 5.5 in" becomes a tab ("Classic stub") with its dimensions beneath. */
const sizeOption = (sz: PrintSize) => {
  const [label, sub] = SIZE_LABEL[sz].split(" · ");
  return { value: sz, label, sub };
};

export default function CheckoutClient({ id }: { id: string }) {
  const router = useRouter();
  const mounted = useMounted();
  const [stub, setStub] = useState<Stub | null | undefined>(undefined);
  const [size, setSize] = useState<PrintSize>("classic");
  const receipt = useReceiptEmail();
  const email = receipt.email;
  const [error, setError] = useState("");
  const [paid, setPaid] = useState(false);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [quoteAt, setQuoteAt] = useState(nowMs);
  const [now, setNow] = useState(nowMs);
  // The stub being priced: material and finish live on it, exactly as in the editor.
  const [draft, setDraft] = useState<Stub | null>(null);

  if (mounted && stub === undefined) {
    const st = getStub(id) ?? null;
    setStub(st);
    if (st) {
      setDraft(st);
      setSize(defaultSize(st));
    }
  }

  useEffect(() => {
    const t = setInterval(() => setNow(nowMs()), 15_000);
    return () => clearInterval(t);
  }, []);

  const material = draft?.material ?? "print";
  const finish = draft?.finish ?? "foil";
  const q = useMemo(() => quote(material, finish, size), [material, finish, size]);
  const physical = material !== "digital";
  const expiresAt = quoteAt + 15 * 60_000;
  const minsLeft = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  const expired = minsLeft === 0;
  const sizes = sizesFor(material);
  const finishLabel = FINISHES.find((f) => f.id === finish)?.label ?? finish;
  const materialLabel = MATERIALS.find((m) => m.id === material)?.label ?? material;

  const prices = Object.fromEntries(FINISHES.map((f) => [f.id, !physical || f.upchargeMinor === 0 ? "Included" : `+${formatMoney(f.upchargeMinor)}`])) as Record<FinishValue, string>;

  function update(next: Stub) {
    setDraft(next);
    setSize((cur) => (sizesFor(next.material).includes(cur) ? cur : defaultSize(next)));
    setQuoteAt(nowMs());
    setError("");
  }

  if (!mounted || stub === undefined) return <PageShell back={{ href: "/wall", label: "Wall" }}>{null}</PageShell>;
  if (stub === null || !draft) {
    return (
      <PageShell back={{ href: "/wall", label: "Wall" }}>
        <EmptyState kind="stub" title="This stub isn't on this device." body="Stubs live on the device that made them. Open your wall and pick the one you want to print.">
          <StampLink href="/wall">Open your wall</StampLink>
        </EmptyState>
      </PageShell>
    );
  }

  function pay() {
    if (!stub || !draft || paid) return;
    if (expired) {
      setError("This quote has run out. Refresh it to see the current price.");
      return;
    }
    if (receipt.problem) {
      setError(receipt.problem);
      return;
    }
    setPaid(true);
    void placeOrder({
      stubIds: [stub.id],
      lines: [{ title: stub.event.title, material, finish, size, totalMinor: q.totalMinor }],
      totalMinor: q.totalMinor,
      currency: q.currency,
      quoteId: q.quoteId,
      method: "card",
      email: email || undefined,
    }).then(setPlaced);
    upsertStub({ ...stub, material, finish, torn: true });
    haptic([18, 40, 28]);
  }

  function toCart() {
    if (!stub || !draft) return;
    addToCart(cartItemFromStub(draft, material, finish, size));
    router.push("/cart");
  }

  const e = stub.event;
  const when = [formatDate(e.dateISO), e.venue].filter(Boolean).join(" · ");

  return (
    <PageShell back={{ href: `/studio/${stub.id}`, label: "Back to your stub" }}>
      <SandboxStrip>{SANDBOX_LABEL}</SandboxStrip>
      <div className={s.layout}>
        <div className={s.desk}>
          <OnDesk>
            <MaterialFrame material={material} finish={finish}>
              <StubView stub={draft} size="md" tilt />
            </MaterialFrame>
          </OnDesk>
          <p className={s.cap}>
            <span className={s.capTitle}>{e.title}</span>
            {when ? <span className={s.capMeta}>{when}</span> : null}
          </p>
        </div>

        <section className={s.sheet} aria-labelledby="co-h">
          <header className={s.head}>
            <p className="desk-label">Checkout</p>
            <h1 id="co-h" className={s.title}>
              {physical ? "Put it on paper." : "Keep it forever."}
            </h1>
          </header>

          <div className={s.group}>
            <span className="desk-label">Material</span>
            <PunchTabs label="Material" options={MATERIAL_OPTIONS} value={material} onChange={(m: Material) => update(applyMaterial(draft, m))} />
          </div>

          <div className={s.group}>
            <span className="desk-label">Finish</span>
            <FinishSwatches
              value={finish}
              prices={prices}
              onChange={(f) => {
                // Holo only exists on Print and Framed, so choosing it moves the stock up and the price shows it.
                if (f === "holo" && !holoAllowed(material)) update(applyFinish(applyMaterial(draft, "print"), "holo"));
                else update(applyFinish(draft, f));
              }}
            />
            <p className={ui.status} aria-live="polite">
              {!physical ? "On screen and on your wallet pass, every finish is included." : holoAllowed(material) ? "Holo is on Print and Framed." : "Holo comes on Print and Framed. Choosing it moves you to Print."}
            </p>
          </div>

          <div className={s.group}>
            <span className="desk-label">Size</span>
            {sizes.length > 1 ? (
              <PunchTabs label="Size" options={sizes.map(sizeOption)} value={size} onChange={(v) => setSize(v)} />
            ) : (
              <p className={s.sizeLine}>
                <span>{sizeOption(size).label}</span>
                <span className={s.sizeSub}>{sizeOption(size).sub}</span>
              </p>
            )}
          </div>

          <Rule kind="perf" />

          <dl className={s.receipt}>
            <div className={s.line}>
              <dt>{materialLabel}</dt>
              <dd>{formatMoney(q.itemMinor)}</dd>
            </div>
            {q.finishMinor ? (
              <div className={s.line}>
                <dt>{finishLabel} finish</dt>
                <dd>{formatMoney(q.finishMinor)}</dd>
              </div>
            ) : null}
            {physical ? (
              <div className={s.line}>
                <dt>Shipping</dt>
                <dd>
                  {formatMoney(q.shippingMinor)}
                  <SourceMark p="estimated" />
                </dd>
              </div>
            ) : null}
            <div className={`${s.line} ${s.total}`}>
              <dt>Total</dt>
              <dd>{formatMoney(q.totalMinor)}</dd>
            </div>
          </dl>
          <div className={s.quote} aria-live="polite">
            {expired ? (
              <>
                <span>This quote has run out.</span>
                <TearLink
                  type="button"
                  onClick={() => {
                    setQuoteAt(nowMs());
                    setError("");
                  }}
                >
                  Refresh the quote
                </TearLink>
              </>
            ) : (
              <span>
                Quote holds for {minsLeft} min
                <SourceMark p="estimated" />. A quote is not a charge.
              </span>
            )}
          </div>

          {paid ? null : <ReceiptField id="co-email" r={receipt} onChange={() => setError("")} />}

          <div className={s.actions}>
            {paid ? (
              <div className={s.done}>
                <AfterPay placed={placed} email={email} signedIn={receipt.signedIn} />
              </div>
            ) : (
              <Stamp block onClick={pay}>
                Pay {formatMoney(q.totalMinor)}
              </Stamp>
            )}
            {error ? (
              <p className={ui.err} role="alert">
                {error}
              </p>
            ) : null}
            <PaperButton type="button" block onClick={toCart} disabled={paid}>
              Add to cart and open it
              <LeavesMark />
            </PaperButton>
          </div>

          <MarkLegend marks={["estimated"]} />
        </section>
      </div>
    </PageShell>
  );
}
