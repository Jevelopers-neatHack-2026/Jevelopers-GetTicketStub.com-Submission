// Procedural, text-free art per edition, deterministic from the art seed.
// Returns CSS `background` values (one per layer). Risograph returns two layers (pink, teal)
// that StubView multiplies together for the overprint look.
import type { Edition } from "../types";
import { rng } from "./rng";

const pct = (n: number) => `${n.toFixed(1)}%`;

function disc(x: number, y: number, r: number, color: string, soft = 0.6): string {
  return `radial-gradient(circle at ${pct(x)} ${pct(y)}, ${color} 0 ${pct(r)}, transparent ${pct(r + soft)})`;
}
function glow(x: number, y: number, r: number, color: string): string {
  return `radial-gradient(circle at ${pct(x)} ${pct(y)}, ${color}, transparent ${pct(r)})`;
}

export function proceduralArt(seed: number, edition: Edition): string[] {
  const r = rng(seed * 7919 + edition.length * 101);
  const R = (a: number, b: number) => a + r() * (b - a);

  switch (edition) {
    case "researched": {
      // night city: dark teal sky, warm window glows, one cyan lamp, one orange accent, rain
      const layers: string[] = [
        `repeating-linear-gradient(104deg, rgb(255 255 255 / 0.05) 0 1px, transparent 1px ${Math.round(R(6, 10))}px)`,
        disc(R(55, 80), R(78, 88), R(2.2, 3.2), "#E4572E", 0.4),
        glow(R(60, 80), R(40, 55), R(10, 16), "rgb(124 198 210 / 0.55)"),
      ];
      const n = 5 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) layers.push(glow(R(15, 85), R(35, 80), R(5, 12), `rgb(233 161 75 / ${R(0.35, 0.75).toFixed(2)})`));
      layers.push(`linear-gradient(180deg, transparent 0 ${pct(R(60, 70))}, rgb(20 32 28 / 0.9) ${pct(R(70, 76))}, #0f1714)`);
      layers.push(`linear-gradient(${Math.round(R(170, 190))}deg, #14201c, #26302a 55%, #3b4a43)`);
      return [layers.join(", ")];
    }
    case "letterpress": {
      const sx = R(30, 70);
      const sy = R(30, 48);
      const bands = Array.from({ length: 4 }, (_, i) => {
        const y = 58 + i * R(7, 10);
        return `linear-gradient(transparent 0 ${pct(y)}, ${i % 2 ? "#8C5A3C" : "#4A2E1E"} ${pct(y)} ${pct(y + R(2, 5))}, transparent ${pct(y + 5)})`;
      });
      return [
        [
          ...bands,
          disc(sx, sy, R(16, 24), "#C4551F"),
          disc(sx + R(-6, 6), sy + R(-4, 4), R(28, 34), "rgb(217 139 79 / 0.35)"),
          `linear-gradient(180deg, #efdcb6, #e3cfa8)`,
        ].join(", "),
      ];
    }
    case "risograph": {
      const pink: string[] = [];
      const teal: string[] = [];
      for (let i = 0; i < 4; i++) pink.push(disc(R(10, 90), R(10, 90), R(12, 30), "#FF48B0"));
      pink.push(`repeating-linear-gradient(${Math.round(R(20, 70))}deg, #FF48B0 0 6px, transparent 6px 14px)`);
      for (let i = 0; i < 3; i++) teal.push(disc(R(10, 90), R(10, 90), R(14, 34), "#00A7B5"));
      teal.push(disc(R(20, 80), R(20, 80), R(6, 10), "#FFE800"));
      return [pink.join(", ") + ", #fff", teal.join(", ") + ", #fff"];
    }
    case "minimal": {
      const x = R(35, 65);
      const y = R(35, 65);
      return [
        [
          disc(x, y, R(24, 32), "#1A1916", 0.3),
          `linear-gradient(${Math.round(R(0, 180))}deg, transparent 0 49.6%, #1A1916 49.6% 50.4%, transparent 50.4%)`,
          "#D9D4C7",
        ].join(", "),
      ];
    }
    case "classic": {
      const x = R(30, 70);
      const y = R(30, 70);
      return [
        [
          `repeating-radial-gradient(circle at ${pct(x)} ${pct(y)}, #2B4C7E 0 2px, transparent 2px ${Math.round(R(6, 9))}px)`,
          `conic-gradient(from ${Math.round(R(0, 360))}deg at ${pct(x)} ${pct(y)}, #7CC6D2 0 25%, #DDEFF2 0 50%, #7CC6D2 0 75%, #DDEFF2 0)`,
        ].join(", "),
      ];
    }
  }
}
