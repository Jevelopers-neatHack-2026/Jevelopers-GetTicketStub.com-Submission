"use client";
// Docks the floating toolbar to the element that is selected on the stub: just above it, or just
// below when the top of the stage is too close. Positions come from the element's real rectangle,
// so it follows zoom, frames, the deal and the stub's own tilt.
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

interface Spot {
  x: number;
  y: number;
  place: "above" | "below";
  arrow: number;
}

const GAP = 10;
const NEEDS = 150; // room the toolbar and its picker need above the element

export function DockedToolbar({ container, active, track, clip = false, children }: { container: RefObject<HTMLElement | null>; active: boolean; track: string; clip?: boolean; children: ReactNode }) {
  const dock = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<Spot | null>(null);

  // The stub settles, tilts and is dealt: measure now, follow it for a moment, then on resize.
  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      const box = container.current;
      const el = box?.querySelector<HTMLElement>("figure[data-edition] button[aria-pressed='true']");
      if (!box || !el) return;
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const w = dock.current?.offsetWidth ?? 0;
      const centre = r.left + r.width / 2 - b.left;
      const half = w / 2;
      const x = Math.min(Math.max(centre, half + 8), Math.max(half + 8, b.width - half - 8));
      // On the cutting mat the stage is a window onto a camera: room is measured in it, and the dock stays inside it.
      const room = clip ? r.top - b.top : r.top;
      const place: Spot["place"] = room > NEEDS ? "above" : "below";
      let y = place === "above" ? r.top - b.top - GAP : r.bottom - b.top + GAP;
      if (clip) {
        const h = dock.current?.offsetHeight ?? 0;
        y = place === "above" ? Math.min(Math.max(y, h + 8), Math.max(h + 8, b.height - 8)) : Math.min(Math.max(y, 8), Math.max(8, b.height - h - 8));
      }
      const arrow = Math.min(Math.max(centre - x + half, 18), Math.max(18, w - 18));
      setSpot((p) => (p && Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5 && p.place === place && Math.abs(p.arrow - arrow) < 0.5 ? p : { x, y, place, arrow }));
    };
    measure();
    let raf = 0;
    const until = performance.now() + 900;
    const tick = () => {
      measure();
      if (performance.now() < until) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", measure);
    window.addEventListener("ts-camera", measure);
    const ro = new ResizeObserver(measure);
    if (container.current) ro.observe(container.current);
    if (dock.current) ro.observe(dock.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("ts-camera", measure);
      ro.disconnect();
    };
  }, [active, track, container, clip]);

  if (!active) return null;
  return (
    <div
      ref={dock}
      data-stub-area
      data-dock={spot?.place ?? "above"}
      style={{
        position: "absolute",
        left: spot?.x ?? 0,
        top: spot?.y ?? 0,
        transform: spot?.place === "below" ? "translate(-50%, 0)" : "translate(-50%, -100%)",
        visibility: spot ? "visible" : "hidden",
        zIndex: 30,
        ["--arrow" as string]: `${spot?.arrow ?? 0}px`,
      }}
    >
      {children}
    </div>
  );
}
