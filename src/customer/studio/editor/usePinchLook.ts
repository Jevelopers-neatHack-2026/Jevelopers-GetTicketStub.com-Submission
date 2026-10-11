"use client";
// Phone: pinch the stub to look closer. Two fingers zoom the deck about the pinch centre (and follow the
// fingers a little); let go and it springs back to fit. There is no persistent pan, so swipe-to-deal and
// tap-to-edit are untouched. Only two touch pointers make a pinch: one finger never does.
import { useEffect, useRef, type RefObject } from "react";

const MAX_LOOK = 3;
const MIN_SPAN = 40; // two fingers closer than this are a mistake, not a pinch
const SPRING_MS = 560;

interface Opts {
  enabled: boolean;
  areaRef: RefObject<HTMLElement | null>;
  /** A pinch begins: other one-finger gestures on the stage stand down. */
  onStart: () => void;
}

export function usePinchLook({ enabled, areaRef, onStart }: Opts): { active: RefObject<boolean> } {
  const active = useRef(false);
  const startRef = useRef(onStart);
  useEffect(() => {
    startRef.current = onStart;
  });

  useEffect(() => {
    if (!enabled) return;
    const area = areaRef.current;
    if (!area) return;
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; cx: number; cy: number; el: HTMLElement } | null = null;
    let settling = 0;
    let lastEnd = 0;
    const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const span = () => {
      const [a, b] = [...touches.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    };

    const begin = () => {
      if (pinch || settling || touches.size !== 2) return;
      const el = area.querySelector<HTMLElement>("[data-deck]");
      if (!el) return;
      const p = span();
      if (p.d < MIN_SPAN) return;
      startRef.current();
      const r = el.getBoundingClientRect();
      pinch = { d: p.d, cx: p.cx, cy: p.cy, el };
      active.current = true;
      el.style.transition = "none";
      el.style.transformOrigin = `${p.cx - r.left}px ${p.cy - r.top}px`;
    };
    const end = () => {
      if (!pinch) return;
      const { el } = pinch;
      pinch = null;
      active.current = false;
      lastEnd = performance.now();
      if (reduced()) {
        el.style.transition = "none";
        el.style.transform = "";
        el.style.transformOrigin = "";
        el.style.transition = "";
        return;
      }
      // spring back to fit
      el.style.transition = `transform ${SPRING_MS}ms var(--desk-spring)`;
      el.style.transform = "";
      settling = window.setTimeout(() => {
        settling = 0;
        el.style.transition = "";
        el.style.transformOrigin = "";
      }, SPRING_MS + 40);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      begin();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinch) return;
      if (touches.size < 2) return;
      const p = span();
      const s = Math.min(MAX_LOOK, Math.max(1, p.d / pinch.d));
      pinch.el.style.transform = `translate(${p.cx - pinch.cx}px, ${p.cy - pinch.cy}px) scale(${s})`;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touches.delete(e.pointerId);
      if (touches.size < 2) end();
    };
    // the lifting fingers must not count as a tap on a field
    const onClick = (e: MouseEvent) => {
      if (pinch || (lastEnd && performance.now() - lastEnd < 400)) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    // while pinching, the page must not scroll under the fingers
    const onTouchMove = (e: TouchEvent) => {
      if (pinch && e.cancelable) e.preventDefault();
    };

    area.addEventListener("pointerdown", onDown, true);
    area.addEventListener("pointermove", onMove);
    area.addEventListener("pointerup", onUp);
    area.addEventListener("pointercancel", onUp);
    area.addEventListener("click", onClick, true);
    area.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      area.removeEventListener("pointerdown", onDown, true);
      area.removeEventListener("pointermove", onMove);
      area.removeEventListener("pointerup", onUp);
      area.removeEventListener("pointercancel", onUp);
      area.removeEventListener("click", onClick, true);
      area.removeEventListener("touchmove", onTouchMove);
      end();
      window.clearTimeout(settling);
    };
  }, [enabled, areaRef]);

  return { active };
}
