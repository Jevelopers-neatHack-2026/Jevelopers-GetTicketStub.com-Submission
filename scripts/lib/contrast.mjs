// WCAG 2.x contrast of the desk colours, read from src/customer/desk/desk.css so a token edit is what gets checked.
// The app is paper only (there is no dark theme), so each text colour is checked on paper, raised and sunk.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The `--name: value;` pairs of the first :root block in desk.css. */
export function deskTokens() {
  const css = readFileSync(join(root, "src/customer/desk/desk.css"), "utf8");
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** "#rrggbb" or "rgb(r g b / a)" as [r, g, b, a]. */
function parse(v) {
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  throw new Error(`cannot read colour "${v}"`);
}

const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function ratio(fg, bg) {
  const a = lum(over(fg, bg));
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** One row per (colour, surface): { name, on, ratio, need }. 4.5 for text, 3 for large text, focus rings and the edges of controls. */
export function contrastRows() {
  const t = deskTokens();
  const tok = (n) => {
    if (!(n in t)) throw new Error(`desk.css has no --${n}`);
    const v = /^var\(--([\w-]+)\)$/.exec(t[n]);
    return v ? tok(v[1]) : parse(t[n]);
  };
  const surfaces = ["desk-paper", "desk-paper-raised", "desk-paper-sunk"];
  const rows = [];
  const add = (name, fg, need, onSurfaces = surfaces) => {
    for (const s of onSurfaces) rows.push({ name, on: s, ratio: ratio(fg, tok(s)), need });
  };
  add("ink text", tok("desk-ink"), 4.5);
  add("soft ink text (labels, hints, placeholders)", tok("desk-ink-soft"), 4.5);
  add("focus ring (ink)", tok("desk-focus"), 3);
  add("control edge (desk-edge)", tok("desk-edge"), 3);
  add("error text and marker (desk-error)", tok("desk-error"), 4.5);
  add("printer's mark (copper)", tok("desk-mark"), 3);
  // disabled controls are exempt from 1.4.3, but they stay readable: the label at its dimmed opacity
  const dim = tok("desk-ink");
  add("disabled text (ink at its dimmed opacity)", [dim[0], dim[1], dim[2], Number(t["desk-disabled-alpha"])], 3);
  // the main action: ink label on the orange stamp
  rows.push({ name: "stamp label on the orange stamp", on: "desk-stamp", ratio: ratio(tok("desk-stamp-label"), tok("desk-stamp")), need: 4.5 });
  return rows;
}
