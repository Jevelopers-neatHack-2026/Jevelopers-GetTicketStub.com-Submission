"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { FitBox } from "@/customer/pages/FitBox";
import { play, haptic } from "@/customer/studio/feedback";
import { getStub, upsertStub } from "@/customer/studio/store";
import { MATERIALS, formatMoney, type Finish, type Material, type Stub } from "@/customer/studio/types";
import { PageShell, SandboxBadge, ui } from "@/customer/pages/ui";
import { FINISHES, SIZE_LABEL, addOrder, addToCart, cartItemFromStub, quote, sizesFor, type PrintSize } from "@/customer/pages/commerce";
import { useMounted, nowMs } from "@/customer/pages/useMounted";
import s from "./checkout.module.css";

export default function CheckoutClient({ id }: { id: string }) {
  const router = useRouter();
  const mounted = useMounted();
  const emailId = useId();
  const [stub, setStub] = useState<Stub | null | undefined>(undefined);
  const [material, setMaterial] = useState<Material>("print");
  const [finish, setFinish] = useState<Finish>("foil");
  const [size, setSize] = useState<PrintSize>("classic");
  const [byCard, setByCard] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [quoteAt, setQuoteAt] = useState(nowMs);
  const [now, setNow] = useState(nowMs);

  if (mounted && stub === undefined) {
    const st = getStub(id) ?? null;
    setStub(st);
    if (st) {
      setMaterial(st.material);
      setFinish(st.finish);
      setSize(sizesFor(st.material)[0]);
    }
  }

  useEffect(() => {
    const t = setInterval(() => setNow(nowMs()), 15_000);
    return () => clearInterval(t);
  }, []);

  const q = useMemo(() => quote(material, finish, size), [material, finish, size]);
  const physical = material !== "digital";
  const expiresAt = quoteAt + 15 * 60_000;
  const minsLeft = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  const expired = minsLeft === 0;

  function pickMaterial(m: Material) {
    setMaterial(m);
    setSize(sizesFor(m)[0]);
    setQuoteAt(nowMs());
    play("tick");
  }

  if (!mounted || stub === undefined) return <PageShell back={{ href: "/wall", label: "Wall" }}>{null}</PageShell>;
  if (stub === null) {
    return (
      <PageShell back={{ href: "/wall", label: "Wall" }}>
        <div className={ui.error}>
          <h1 className={ui.h2}>We couldn&apos;t find this stub on this device.</h1>
          <p className={ui.muted}>Open your wall and pick the stub you want to print.</p>
          <Link className="btn btn-primary" href="/wall">
            Open your wall
          </Link>
        </div>
      </PageShell>
    );
  }

  function pay(method: "apple-pay" | "google-pay" | "card") {
    if (!stub) return;
    if (expired) {
      setError("This quote expired. Refresh the quote to see the current price.");
      return;
    }
    if (method === "card" && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Add the email for your receipt and wall link.");
      return;
    }
    setPaying(true);
    addOrder({
      stubIds: [stub.id],
      lines: [{ title: stub.event.title, material, finish, size, totalMinor: q.totalMinor }],
      totalMinor: q.totalMinor,
      method,
      email: method === "card" ? email.trim() : undefined,
    });
    upsertStub({ ...stub, material, finish, torn: true });
    play("stamp");
    haptic([18, 40, 28]);
    router.push("/wall?email=sent");
  }

  function toCart() {
    if (!stub) return;
    addToCart(cartItemFromStub(stub, material, finish, size));
    play("pin");
    router.push("/cart");
  }

  const preview: Stub = { ...stub, material, finish };
  const materialLabel = MATERIALS.find((m) => m.id === material)?.label ?? material;

  return (
    <PageShell back={{ href: `/studio/${stub.id}`, label: "Back to your stub" }} right={<SandboxBadge />}>
      <div className={s.layout}>
        <div className={s.thumb}>
          <FitBox>
            <StubView stub={preview} size="md" tilt />
          </FitBox>
          <p className={`${ui.muted} ${s.thumbCap}`}>{stub.event.title}</p>
        </div>

        <section className={`sheet ${s.sheet}`} aria-labelledby="co-h">
          <div className={s.sheetHead}>
            <h1 id="co-h" className={ui.h2}>
              {physical ? `Print it for ${formatMoney(q.itemMinor)}` : `Keep it for ${formatMoney(q.itemMinor)}`}
            </h1>
            <SandboxBadge />
          </div>

          <fieldset className={s.fieldset}>
            <legend className="label">Material</legend>
            <div className={s.options}>
              {MATERIALS.map((m) => (
                <label key={m.id} className={s.option}>
                  <input type="radio" name="material" value={m.id} checked={material === m.id} onChange={() => pickMaterial(m.id)} />
                  <span className={s.optLabel}>{m.label}</span>
                  <span className={`${s.optPrice} num`}>{formatMoney(m.priceMinor)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={s.fieldset}>
            <legend className="label">Finish</legend>
            <div className={s.options}>
              {FINISHES.map((f) => (
                <label key={f.id} className={s.option}>
                  <input
                    type="radio"
                    name="finish"
                    value={f.id}
                    checked={finish === f.id}
                    onChange={() => {
                      setFinish(f.id);
                      setQuoteAt(nowMs());
                      play("tick");
                    }}
                  />
                  <span className={s.optLabel}>{f.label}</span>
                  <span className={`${s.optPrice} num`}>{physical && f.upchargeMinor ? `+${formatMoney(f.upchargeMinor)}` : "Included"}</span>
                </label>
              ))}
            </div>
            {!physical ? <p className={ui.muted}>Digital finishes show on screen and on your wallet pass.</p> : null}
          </fieldset>

          {sizesFor(material).length > 1 ? (
            <fieldset className={s.fieldset}>
              <legend className="label">Size</legend>
              <div className={s.options}>
                {sizesFor(material).map((sz) => (
                  <label key={sz} className={s.option}>
                    <input type="radio" name="size" value={sz} checked={size === sz} onChange={() => setSize(sz)} />
                    <span className={s.optLabel}>{SIZE_LABEL[sz]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className={s.sizeLine}>
              <span className="label">Size</span> {SIZE_LABEL[size]}
            </p>
          )}

          <dl className={s.summary}>
            <div>
              <dt>
                {materialLabel} · {SIZE_LABEL[size]}
              </dt>
              <dd className="num">{formatMoney(q.itemMinor)}</dd>
            </div>
            {q.finishMinor ? (
              <div>
                <dt>{FINISHES.find((f) => f.id === finish)?.label} finish</dt>
                <dd className="num">{formatMoney(q.finishMinor)}</dd>
              </div>
            ) : null}
            {physical ? (
              <div>
                <dt>
                  Shipping <span className="provenance">estimated</span>
                </dt>
                <dd className="num">{formatMoney(q.shippingMinor)}</dd>
              </div>
            ) : null}
            <div className={s.total}>
              <dt>Total</dt>
              <dd className="num">{formatMoney(q.totalMinor)}</dd>
            </div>
          </dl>
          <p className={s.quoteLine}>
            {expired ? (
              <>
                Quote expired.{" "}
                <button type="button" className={s.linkBtn} onClick={() => setQuoteAt(nowMs())}>
                  Refresh the quote
                </button>
              </>
            ) : (
              <>Quote expires in {minsLeft} min. A quote is not a charge.</>
            )}
          </p>

          <div className={ui.stack}>
            <button type="button" className={`btn btn-block ${s.pay}`} onClick={() => pay("apple-pay")} disabled={paying}>
              Pay with Apple Pay
            </button>
            <button type="button" className={`btn btn-block ${s.pay}`} onClick={() => pay("google-pay")} disabled={paying}>
              Pay with Google Pay
            </button>
            <p className={s.sandboxNote}>Sandbox · no real charge. We&apos;ll email a link to your wall.</p>

            {byCard ? (
              <form
                className={ui.stack}
                onSubmit={(e) => {
                  e.preventDefault();
                  pay("card");
                }}
              >
                <div className={ui.field}>
                  <label htmlFor={emailId} className={ui.fieldLabel}>
                    Email for your receipt and wall link
                  </label>
                  <input
                    id={emailId}
                    type="email"
                    className={ui.input}
                    value={email}
                    autoComplete="email"
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError("");
                    }}
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-block" disabled={paying}>
                  Pay {formatMoney(q.totalMinor)} by card (sandbox)
                </button>
              </form>
            ) : (
              <button type="button" className="btn btn-quiet btn-block" onClick={() => setByCard(true)}>
                Pay by card instead
              </button>
            )}
            {error ? (
              <p className={s.err} role="alert">
                {error}
              </p>
            ) : null}
            <button type="button" className="btn btn-block" onClick={toCart}>
              Add to cart instead
            </button>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
