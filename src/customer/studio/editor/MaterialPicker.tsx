"use client";
import type { Finish, Material, Stub } from "../types";
import { MATERIALS, formatMoney } from "../types";
import { FINISHES } from "@/customer/pages/commerce";
import { FinishSwatches, PunchTabs, type FinishValue } from "@/customer/desk/Desk";
import { holoAllowed, setFinish, setMaterial } from "./ops";
import styles from "./Tray.module.css";

export function priceOf(m: Material): number {
  return MATERIALS.find((x) => x.id === m)?.priceMinor ?? 0;
}

/** Finish add-ons only cost money on a physical stock; on screen they are included. */
export function finishMinor(material: Material, finish: Finish): number {
  if (material === "digital") return 0;
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

interface Props {
  stub: Stub;
  onChange: (s: Stub) => void;
}

const OPTIONS = MATERIALS.map((m) => ({ value: m.id, label: m.label, sub: formatMoney(m.priceMinor) }));

/** Digital $9 · Card $29 · Print $49 · Framed $89, then the finish. Re-renders the stub on that stock. */
export function MaterialPicker({ stub, onChange }: Props) {
  const physical = stub.material !== "digital";
  const prices = Object.fromEntries(FINISHES.map((f) => [f.id, !physical || f.upchargeMinor === 0 ? "Included" : `+${formatMoney(f.upchargeMinor)}`])) as Record<FinishValue, string>;
  const holoOk = holoAllowed(stub.material);

  return (
    <div className={styles.picker}>
      <div className={styles.group}>
        <span className="desk-label">Material</span>
        <PunchTabs label="Material" options={OPTIONS} value={stub.material} onChange={(m) => onChange(setMaterial(stub, m))} />
      </div>
      <div className={styles.group}>
        <span className="desk-label">Finish</span>
        <FinishSwatches
          value={stub.finish}
          prices={prices}
          onChange={(f) => {
            // Holo only exists on Print and Framed, so choosing it moves the stock up and the price shows it.
            if (f === "holo" && !holoOk) onChange(setFinish(setMaterial(stub, "print"), "holo"));
            else onChange(setFinish(stub, f));
          }}
        />
        <p className={styles.note} aria-live="polite">
          {holoOk ? "Holo is on Print and Framed." : "Holo comes on Print and Framed. Choosing it moves you to Print."}
        </p>
      </div>
    </div>
  );
}
