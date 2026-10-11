// Foil + glare layers for StubView. Place inside a positioned face (absolute, inset 0).
// Reads the smoothed vars from useTilt (--lx --ly --px --py --glow); renders nothing that moves on its own.
// - finish "foil": brand foil sheen (copper -> cyan band, overlay <= 0.5) + glare (overlay <= 0.3)
// - finish "holo": seeded halftone plate x holo spectrum (screen, 0.42 + 0.52 glow) + glare
// - finish "matte": a faint glare only
import type { CSSProperties } from "react";
import type { Finish } from "../types";
import { hashSeed, rng } from "./rng";
import styles from "./Foil.module.css";

/** Class for a foil-ink title (gradient clipped to text, band follows the light). */
export const foilTextClass = styles.foilText;

export function platePattern(seed: string | number): CSSProperties {
  const r = rng(hashSeed(seed));
  const cell = 6 + Math.round(r() * 3); // 6..9px
  const dot = (cell * (0.14 + r() * 0.06)).toFixed(2); // ~6-13% coverage: a glint, not a wash
  const angle = Math.round(15 + r() * 60);
  const off = Math.round(r() * cell);
  return {
    ["--cell" as string]: `${cell}px`,
    ["--dot" as string]: `${dot}px`,
    ["--angle" as string]: `${angle}deg`,
    ["--off" as string]: `${off}px`,
  };
}

export function Foil({ finish, seed, className }: { finish: Finish; seed: string | number; className?: string }) {
  return (
    <div className={`${styles.layers} ${finish === "matte" ? styles.matte : ""} ${className ?? ""}`} aria-hidden="true">
      {finish === "holo" && (
        <div className={styles.holo}>
          <div className={styles.plate} style={platePattern(seed)} />
          <div className={styles.spectrum} />
        </div>
      )}
      {finish === "foil" && <div className={styles.sheen} />}
      <div className={styles.glare} />
    </div>
  );
}
