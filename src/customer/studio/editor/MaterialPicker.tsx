"use client";
import { useId, useRef } from "react";
import type { Finish, Material, Stub } from "../types";
import { MATERIALS, formatMoney } from "../types";
import { play } from "@/customer/studio/feedback";
import { holoAllowed, setFinish, setMaterial } from "./ops";
import styles from "./overlays.module.css";

const FINISHES: { id: Finish; label: string }[] = [
  { id: "matte", label: "Matte" },
  { id: "foil", label: "Foil" },
  { id: "holo", label: "Holo" },
];

export function priceOf(m: Material): number {
  return MATERIALS.find((x) => x.id === m)?.priceMinor ?? 0;
}

export function ctaLabel(m: Material): string {
  const price = formatMoney(priceOf(m));
  return m === "digital" ? `Get it for ${price}` : `Print it for ${price}`;
}

interface Props {
  stub: Stub;
  onChange: (s: Stub) => void;
}

/** Digital $9 · Card $29 · Print $49 · Framed $89, plus the finish. Re-renders the stub on that stock. */
export function MaterialPicker({ stub, onChange }: Props) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = MATERIALS.findIndex((m) => m.id === stub.material);

  const pick = (m: Material) => {
    if (m === stub.material) return;
    play("tick");
    onChange(setMaterial(stub, m));
  };

  const onKey = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const next = (idx + dir + MATERIALS.length) % MATERIALS.length;
    pick(MATERIALS[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className={styles.stack}>
      <div className={styles.rowBetween}>
        <span className="label" id={labelId}>Material</span>
        <span className="provenance">Sandbox prices</span>
      </div>
      <div className={styles.segmented} role="radiogroup" aria-labelledby={labelId} onKeyDown={onKey}>
        {MATERIALS.map((m, i) => (
          <button
            key={m.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={m.id === stub.material}
            tabIndex={m.id === stub.material ? 0 : -1}
            className={styles.segment}
            onClick={() => pick(m.id)}
          >
            <span>{m.label}</span>
            <span className="num">{formatMoney(m.priceMinor)}</span>
          </button>
        ))}
      </div>
      <div className={styles.chipRow} role="group" aria-label="Finish">
        {FINISHES.map((f) => {
          const blocked = f.id === "holo" && !holoAllowed(stub.material);
          return (
            <button
              key={f.id}
              type="button"
              className="chip"
              aria-pressed={stub.finish === f.id}
              disabled={blocked}
              title={blocked ? "Holo is for Print and Framed" : undefined}
              onClick={() => {
                play("tick");
                onChange(setFinish(stub, f.id));
              }}
            >
              {f.label}
            </button>
          );
        })}
        {!holoAllowed(stub.material) && <span className={styles.muted}>Holo on Print and Framed</span>}
      </div>
    </div>
  );
}
