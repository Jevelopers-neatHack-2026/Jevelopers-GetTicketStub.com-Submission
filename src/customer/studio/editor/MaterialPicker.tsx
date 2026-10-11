"use client";
import type { Finish, Material, Stub } from "../types";
import { MATERIALS, formatMoney } from "../types";
import { FINISHES, cartItemState, defaultSize, finishMarks, finishPrices, type CartItem, type PrintSize } from "@/customer/pages/commerce";
import { CHOOSE_AGAIN_BODY, CHOOSE_AGAIN_WORDS, HOLO_WORDS, SIZE_COPY, statusLine, statusMark, variantFor } from "@/customer/pages/capabilities";
import { TearAnchor } from "@/customer/pages/ui";
import { FinishSwatches, PunchTabs, SourceMark } from "@/customer/desk/Desk";
import styles from "./Tray.module.css";

export function priceOf(m: Material): number {
  return MATERIALS.find((x) => x.id === m)?.priceMinor ?? 0;
}

/** Finish add-ons only cost money on a physical stock, and Holo is a screen effect that is never printed. On screen they are included. */
export function finishMinor(material: Material, finish: Finish): number {
  if (material === "digital" || finish === "holo") return 0;
  return FINISHES.find((f) => f.id === finish)?.upchargeMinor ?? 0;
}

/** What the "Print it" stamp carries: the stock plus the finish add-on, the same sum checkout shows. */
export function totalLabel(m: Material, f: Finish): string {
  return formatMoney(priceOf(m) + finishMinor(m, f));
}

export function ctaVerb(m: Material): string {
  return m === "digital" ? "Get it" : "Print it";
}

export function ctaLabel(m: Material): string {
  const price = formatMoney(priceOf(m));
  return m === "digital" ? `Get it for ${price}` : `Print it for ${price}`;
}

/** Every finish exists on every stock as a screen preview, so choosing a stock keeps the finish. What can be ordered is the note's job. */
export function pickMaterial(stub: Stub, material: Material): Stub {
  return material === stub.material ? stub : { ...stub, material };
}
export function pickFinish(stub: Stub, finish: Finish): Stub {
  return finish === stub.finish ? stub : { ...stub, finish };
}

/**
 * What the chosen stock, size and finish really is, in the printer's marks: the status, what the finish is, and what
 * the size number measures. One of these sits wherever a size, finish or material is chosen.
 */
export function VariantNote({ material, finish, size, withSize = true }: { material: Material; finish: Finish; size: PrintSize; withSize?: boolean }) {
  const v = variantFor(material, size, finish);
  if (!v) return null;
  const mark = statusMark(v.status);
  const copy = SIZE_COPY[size];
  return (
    <div className={styles.variant} aria-live="polite" data-status={v.status}>
      <p className={styles.variantStatus}>
        {mark ? <SourceMark p={mark} /> : null}
        <span>{statusLine(v)}</span>
      </p>
      {finish !== "matte" ? <p className={styles.note}>{finish === "holo" ? (material === "digital" ? "Holo is a screen effect. Nothing is printed." : `${HOLO_WORDS}. Choose Matte or Foil to print it.`) : v.finishNote}</p> : null}
      {withSize ? (
        <p className={styles.note}>
          <span className={styles.measure}>{copy.measure}</span> · {copy.caption}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A cart line described through the capability map: stock, finish, what the size measures and its status. A line saved
 * before the map has no verified mapping, so it is never re-described as a new spec: it says "Choose again" instead.
 */
export function CartLineSpec({ item, className }: { item: CartItem; className?: string }) {
  const res = cartItemState(item);
  const material = MATERIALS.find((x) => x.id === item.material)?.label ?? item.material;
  const finish = FINISHES.find((f) => f.id === item.finish)?.label ?? item.finish;
  if (res.state === "choose-again") {
    return (
      <>
        <p className={className}>
          {material} · {finish} · saved before sizes were checked
        </p>
        <p className={className} data-choose-again role="status">
          <SourceMark p="blocked" /> {CHOOSE_AGAIN_BODY}
        </p>
        <p>
          <TearAnchor href={`/checkout/${item.stubId}`}>{CHOOSE_AGAIN_WORDS}</TearAnchor>
        </p>
      </>
    );
  }
  const mark = statusMark(res.variant.status);
  return (
    <>
      <p className={className}>
        {material} · {finish} · {SIZE_COPY[item.size].name} · {SIZE_COPY[item.size].measure}
      </p>
      <p className={className}>
        {mark ? <SourceMark p={mark} /> : null} {statusLine(res.variant)}
      </p>
    </>
  );
}

interface Props {
  stub: Stub;
  onChange: (s: Stub) => void;
}

const OPTIONS = MATERIALS.map((m) => ({ value: m.id, label: m.label, sub: formatMoney(m.priceMinor) }));

/** Digital $9 · Card $29 · Print $49 · Framed $89 (sandbox fixtures), then the finish. Re-renders the stub on that stock. */
export function MaterialPicker({ stub, onChange }: Props) {
  const size = defaultSize(stub);
  return (
    <div className={styles.picker}>
      <div className={styles.group}>
        <span className="desk-label">Material</span>
        <PunchTabs label="Material" options={OPTIONS} value={stub.material} onChange={(m) => onChange(pickMaterial(stub, m))} />
      </div>
      <div className={styles.group}>
        <span className="desk-label">Finish</span>
        <FinishSwatches value={stub.finish} prices={finishPrices(stub.material)} marks={finishMarks(stub.material, size)} onChange={(f) => onChange(pickFinish(stub, f))} />
        <VariantNote material={stub.material} finish={stub.finish} size={size} />
      </div>
    </div>
  );
}
