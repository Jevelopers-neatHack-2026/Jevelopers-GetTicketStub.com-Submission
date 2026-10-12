// Where stubs sit on the canvas. A stub's spot is {wallX, wallY} in canvas coordinates (px at 100%, any value,
// negative too), kept on the stub itself so the account sync carries it across devices. The fields are optional:
// a stub that has none yet is dealt into the next free slot of a loose grid.
import type { Stub } from "@/customer/studio/types";

/** A stub with its canvas spot. (Types lives outside this feature, so the two fields are named here.) */
export type PlacedStub = Stub & { wallX?: number; wallY?: number };

export const CELL_W = 260;
export const CELL_H = 330;

const has = (s: PlacedStub) => Number.isFinite(s.wallX) && Number.isFinite(s.wallY);

/** A small, stable wobble from the id, so the grid reads as pinned by hand. */
function wobble(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 29) - 14;
}

/** Columns for a first deal: as many as the screen holds, from 2 to 5. */
export function dealColumns(): number {
  const w = typeof window === "undefined" ? 1000 : window.innerWidth;
  return Math.max(2, Math.min(5, Math.floor((w - 40) / CELL_W)));
}

/** Give every stub without a spot the next free slot. Stubs that already have one are untouched. Returns the ids it placed. */
export function dealMissing(stubs: PlacedStub[], cols = dealColumns()): { stubs: PlacedStub[]; placed: string[] } {
  const taken = stubs.filter(has).map((s) => [s.wallX as number, s.wallY as number] as const);
  const free = (x: number, y: number) => !taken.some(([tx, ty]) => Math.abs(tx - x) < CELL_W * 0.6 && Math.abs(ty - y) < CELL_H * 0.6);
  let slot = 0;
  const placed: string[] = [];
  const next = stubs.map((s) => {
    if (has(s)) return s;
    let x = 0;
    let y = 0;
    do {
      x = (slot % cols) * CELL_W;
      y = Math.floor(slot / cols) * CELL_H;
      slot++;
    } while (!free(x, y));
    x += wobble(s.id, 3);
    y += wobble(s.id, 7);
    taken.push([x, y]);
    placed.push(s.id);
    return { ...s, wallX: x, wallY: y };
  });
  return { stubs: next, placed };
}

/** A fresh small tilt for a stub that was just pinned back: -4 to 4 degrees, one decimal, like a new stub's. */
export const freshAngle = () => Math.round((Math.random() * 8 - 4) * 10) / 10;
