// Foil + glare layers for StubView. Place inside a positioned face (absolute, inset 0).
// Reads the smoothed vars from useTilt (--lx --ly --px --py --glow); renders nothing that moves on its own.
// - finish "foil": brand foil sheen (copper -> cyan band, overlay <= 0.5) + glare (overlay <= 0.3)
// - finish "holo": seeded flake plate x soft spectrum (screen, 0.12 + 0.5 glow) + glare
// - finish "matte": a faint glare only
import type { CSSProperties } from "react";
import type { Finish } from "../types";
import { hashSeed, rng } from "./rng";
import styles from "./Foil.module.css";

/** Class for a foil-ink title (gradient clipped to text, band follows the light). */
export const foilTextClass = styles.foilText;

/**
 * Holographic stock plate: a fine flake film (seeded noise, thresholded so only the brightest
 * flakes catch light), fixed to the stub. Coarse enough to read as glitter film under a lamp, fine
 * enough that no grid or dot pattern shows at arm's length.
 */
export function platePattern(seed: string | number): CSSProperties {
  const r = rng(hashSeed(seed));
  const s = Math.floor(r() * 1000);
  const freq = (0.62 + r() * 0.12).toFixed(3);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='2' seed='${s}' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/><feComponentTransfer><feFuncR type='linear' slope='3.2' intercept='-1.7'/><feFuncG type='linear' slope='3.2' intercept='-1.7'/><feFuncB type='linear' slope='3.2' intercept='-1.7'/></feComponentTransfer></filter><rect width='100%' height='100%' filter='url(%23f)'/></svg>`;
  return { ["--plate" as string]: `url("data:image/svg+xml;utf8,${svg}")` };
}

export function Foil({ finish, seed, className }: { finish: Finish; seed: string | number; className?: string }) {
  return (
    <div className={`${styles.layers} ${finish === "matte" ? styles.matte : ""} ${className ?? ""}`} aria-hidden="true">
      {finish === "holo" && (
        <>
          <div className={styles.holo} style={platePattern(seed)}>
            <div className={styles.plate} />
            <div className={styles.spectrum} />
          </div>
          <div className={styles.tint} style={platePattern(seed)} />
        </>
      )}
      {finish === "foil" && <div className={styles.sheen} />}
      <div className={styles.glare} />
    </div>
  );
}
