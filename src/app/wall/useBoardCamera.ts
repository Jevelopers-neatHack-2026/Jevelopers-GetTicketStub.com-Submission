"use client";
// The corkboard's camera. One state, {x, y, s}, is the whole truth: it moves the world layer (the stubs) and the
// cork texture under it. It lives in a ref and is painted from requestAnimationFrame, so zooming and panning never
// re-render React.
//
//   screen = camera.xy + world * camera.s      (world = canvas px at 100%, the origin is the world layer's top left)
//
// The canvas has no edges: the camera pans without bounds. Fit frames every stub; when none is on screen the
// area flags itself (data-lost) and the "Back to your stubs" control shows.
//
// The input heuristics are the cutting mat's (editor/useCamera.ts), kept in step so both boards feel alike:
// a mouse wheel zooms about the pointer, a trackpad's two-finger scroll pans, ctrl+wheel (pinch) zooms,
// middle-drag, space + drag and a drag on empty cork pan, two fingers pinch and pan, + - 0 and arrows work from the
// keyboard, double-click fits.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 3;
const KEY_STEP = 1.25;
const PAN_STEP = 64;
const EASE_MS = 70; // time constant of the eased zoom
const FIT_PAD = 56;
/** Cork tiles, in px at 100%: chips, pores, grain. Same order as the layers in canvas.module.css. */
const TILES = [300, 220, 160];

interface Cam {
  x: number;
  y: number;
  s: number;
}
interface Anchor {
  px: number;
  py: number;
  wx: number;
  wy: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* Wheel classification: a browser gives no flag for "mouse" or "trackpad", so it is inferred, most certain evidence
   first, and latched for the burst (reset after 300 ms of quiet). See editor/useCamera.ts for the reasoning. */
type Device = "wheel" | "pad";

export interface BoardCamera {
  /** Glide to frame every stub. */
  fit: () => void;
  /** Measure the stubs, then frame them now (a visit starts here). */
  fitNow: () => void;
  /** Re-read where the stubs are (after one moved, was added or filtered). */
  measure: () => void;
  zoomBy: (factor: number) => void;
  scale: () => number;
  /** True while a drag-pan is running, so other pointer gestures on the board stand down. */
  panning: RefObject<boolean>;
  /** True once the visitor has moved the camera themselves. */
  touched: RefObject<boolean>;
}

interface Opts {
  areaRef: RefObject<HTMLElement | null>;
  /** The public wall has nothing to drag, so a drag that starts on a stub pans instead. */
  grabStubs: boolean;
  /** Another gesture (a stub drag) must give way, as a second finger landed. */
  onCancelGesture: () => void;
}

export function useBoardCamera({ areaRef, grabStubs, onCancelGesture }: Opts): BoardCamera {
  const cam = useRef<Cam>({ x: 0, y: 0, s: 1 });
  const tgt = useRef<Cam>({ x: 0, y: 0, s: 1 });
  const anchor = useRef<Anchor | null>(null);
  const rects = useRef<Rect[]>([]);
  const raf = useRef(0);
  const last = useRef(0);
  const idle = useRef(0);
  const panning = useRef(false);
  const touched = useRef(false);
  const cancelRef = useRef(onCancelGesture);
  const grabRef = useRef(grabStubs);
  useEffect(() => {
    cancelRef.current = onCancelGesture;
    grabRef.current = grabStubs;
  });

  /* ---------- painting ---------- */
  const paint = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    const world = area.querySelector<HTMLElement>("[data-cam-world]");
    if (!world) return;
    const { x, y, s } = cam.current;
    world.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    // the cork is endless: its tiles scale and slide with the camera. The light and shade layers stay on the glass.
    area.style.backgroundSize = `${TILES.map((t) => `${t * s}px ${t * s}px`).join(", ")}, 100% 100%, 100% 100%`;
    area.style.backgroundPosition = `${TILES.map(() => `${x}px ${y}px`).join(", ")}, 0 0, 0 0`;

    const host = area.parentElement;
    const pct = Math.round(s * 100);
    const pctEl = host?.querySelector<HTMLElement>("[data-cam-pct]");
    if (pctEl && pctEl.textContent !== `${pct}%`) pctEl.textContent = `${pct}%`;

    // lost: stubs exist, and none shows (24 px of any edge is enough to count)
    const aw = area.clientWidth;
    const ah = area.clientHeight;
    const list = rects.current;
    const seen = list.some((r) => {
      const l = x + r.x * s;
      const t = y + r.y * s;
      return l + r.w * s > 24 && t + r.h * s > 24 && l < aw - 24 && t < ah - 24;
    });
    const lost = list.length > 0 && !seen;
    if ((area.dataset.lost === "true") !== lost) area.dataset.lost = lost ? "true" : "false";
  }, [areaRef]);

  /* ---------- the loop ---------- */
  const flagMoving = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    // will-change keeps a drag cheap, but is dropped at rest so the stubs are re-sharpened at their new size
    area.dataset.moving = "true";
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => delete area.dataset.moving, 160);
  }, [areaRef]);

  const loop = useRef<(now: number) => void>(() => {});
  const frame = useCallback(
    (now: number) => {
      raf.current = 0;
      const dt = Math.min(48, now - (last.current || now - 16));
      last.current = now;
      const c = cam.current;
      const t = tgt.current;
      let more = false;
      if (anchor.current) {
        const a = anchor.current;
        const ds = Math.log(t.s / c.s);
        if (Math.abs(ds) < 0.0006) {
          c.s = t.s;
        } else {
          c.s = c.s * Math.exp(ds * (1 - Math.exp(-dt / EASE_MS)));
          more = true;
        }
        c.x = a.px - a.wx * c.s;
        c.y = a.py - a.wy * c.s;
        if (!more) {
          t.x = c.x;
          t.y = c.y;
          anchor.current = null;
        }
      } else if (c.x !== t.x || c.y !== t.y || c.s !== t.s) {
        const k = 1 - Math.exp(-dt / EASE_MS);
        const near = Math.abs(t.x - c.x) < 0.3 && Math.abs(t.y - c.y) < 0.3 && Math.abs(Math.log(t.s / c.s)) < 0.0006;
        if (near) {
          c.x = t.x;
          c.y = t.y;
          c.s = t.s;
        } else {
          c.x += (t.x - c.x) * k;
          c.y += (t.y - c.y) * k;
          c.s *= Math.exp(Math.log(t.s / c.s) * k);
          more = true;
        }
      }
      paint();
      flagMoving();
      if (more) raf.current = requestAnimationFrame((n) => loop.current(n));
    },
    [paint, flagMoving],
  );
  useEffect(() => {
    loop.current = frame;
  });
  const kick = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame((n) => loop.current(n));
  }, []);

  /** Set the camera now (drags, reduced motion). */
  const jump = useCallback(
    (next: Cam) => {
      anchor.current = null;
      cam.current = { ...next };
      tgt.current = { ...next };
      kick();
    },
    [kick],
  );

  /** Eased move to a target (keys, buttons, fit). */
  const glide = useCallback(
    (next: Cam) => {
      if (reduced()) {
        jump(next);
        return;
      }
      anchor.current = null;
      tgt.current = { ...next };
      kick();
    },
    [jump, kick],
  );

  /** Zoom about a point on the area (px from its top left). Wheel steps stack up on the target scale. */
  const zoomAt = useCallback(
    (px: number, py: number, factor: number, instant = false) => {
      const c = cam.current;
      const from = anchor.current ? tgt.current.s : c.s;
      const s = clamp(from * factor, MIN_SCALE, MAX_SCALE);
      if (instant || reduced()) {
        const real = clamp(c.s * factor, MIN_SCALE, MAX_SCALE);
        const wx = (px - c.x) / c.s;
        const wy = (py - c.y) / c.s;
        jump({ s: real, x: px - wx * real, y: py - wy * real });
        return;
      }
      anchor.current = { px, py, wx: (px - c.x) / c.s, wy: (py - c.y) / c.s };
      tgt.current = { ...tgt.current, s };
      kick();
    },
    [jump, kick],
  );

  /* ---------- where the stubs are ---------- */
  const measure = useCallback(() => {
    const area = areaRef.current;
    const world = area?.querySelector<HTMLElement>("[data-cam-world]");
    if (!area || !world) return;
    const wr = world.getBoundingClientRect(); // a zero-size layer: its corner is where the camera put the origin
    const s = cam.current.s || 1;
    rects.current = [...world.querySelectorAll<HTMLElement>("[data-stub-area]:not([data-dim])")].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - wr.left) / s, y: (r.top - wr.top) / s, w: r.width / s, h: r.height / s };
    });
    paint();
  }, [areaRef, paint]);

  /** The camera that frames every stub: centred, never zoomed in past 100%. */
  const fitTarget = useCallback((): Cam => {
    const area = areaRef.current;
    const list = rects.current;
    if (!area || list.length === 0) return { x: area ? area.clientWidth / 2 : 0, y: area ? area.clientHeight / 2 : 0, s: 1 };
    const x0 = Math.min(...list.map((r) => r.x));
    const y0 = Math.min(...list.map((r) => r.y));
    const x1 = Math.max(...list.map((r) => r.x + r.w));
    const y1 = Math.max(...list.map((r) => r.y + r.h));
    const aw = area.clientWidth;
    const ah = area.clientHeight;
    const s = clamp(Math.min(aw / (x1 - x0 + FIT_PAD * 2), ah / (y1 - y0 + FIT_PAD * 2), 1), MIN_SCALE, MAX_SCALE);
    return { s, x: aw / 2 - ((x0 + x1) / 2) * s, y: ah / 2 - ((y0 + y1) / 2) * s };
  }, [areaRef]);

  const fit = useCallback(() => {
    measure();
    glide(fitTarget());
  }, [measure, glide, fitTarget]);
  const fitNow = useCallback(() => {
    measure();
    jump(fitTarget());
  }, [measure, jump, fitTarget]);
  const zoomBy = useCallback(
    (f: number) => {
      const a = areaRef.current;
      if (a) zoomAt(a.clientWidth / 2, a.clientHeight / 2, f);
    },
    [areaRef, zoomAt],
  );
  const scale = useCallback(() => cam.current.s, []);

  // Stop the loop on unmount.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      window.clearTimeout(idle.current);
    };
  }, []);

  /* ---------- input ---------- */
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const rectOf = () => area.getBoundingClientRect();
    const onStub = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("[data-stub-area]");
    const onUi = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("[data-cam-ui]");
    const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");

    // wheel
    const dev = { kind: (isMac() ? "pad" : "wheel") as Device, at: 0 };
    const onWheel = (e: WheelEvent) => {
      if (onUi(e.target)) return;
      e.preventDefault();
      touched.current = true;
      const now = performance.now();
      const gap = now - dev.at;
      dev.at = now;
      const mul = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * mul;
      const dy = e.deltaY * mul;
      const r = rectOf();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;

      if (e.ctrlKey) {
        // pinch (or ctrl + mouse wheel): proportional, with a ceiling so one notch can't overshoot
        zoomAt(px, py, Math.exp(-clamp(dy, -40, 40) * 0.01), true);
        return;
      }
      if (gap > 300) dev.kind = isMac() ? "pad" : "wheel";
      const wd = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
      if (e.deltaMode !== 0) dev.kind = "wheel";
      else if (wd && wd % 120 === 0 && wd !== -3 * e.deltaY && e.deltaX === 0) dev.kind = "wheel";
      else if (!Number.isInteger(e.deltaX) || !Number.isInteger(e.deltaY) || (e.deltaX !== 0 && !e.shiftKey)) dev.kind = "pad";
      else if (Math.abs(e.deltaY) >= 100 && e.deltaY % 100 === 0 && gap > 60) dev.kind = "wheel";

      if (e.shiftKey && dy === 0 && dx !== 0) {
        // shift + wheel arrives as horizontal scroll: pan sideways
        jump({ ...cam.current, x: cam.current.x - dx });
      } else if (dev.kind === "pad") {
        jump({ ...cam.current, x: cam.current.x - dx, y: cam.current.y - dy });
      } else {
        // the step is proportional to the notch, so one notch is about 22%
        zoomAt(px, py, Math.exp(-clamp(dy, -240, 240) * 0.002));
      }
    };

    // drag
    let space = false;
    let hover = false;
    const drag = { id: -1, x: 0, y: 0, moved: 0 };
    const touchPts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; s: number; wx: number; wy: number } | null = null;
    const setMode = () => {
      if (space && hover) area.dataset.space = "true";
      else delete area.dataset.space;
    };
    const stop = () => {
      panning.current = false;
      delete area.dataset.panning;
    };
    const onDown = (e: PointerEvent) => {
      if (drag.id === -1 && !pinch) drag.moved = 0;
      if (onUi(e.target)) return;
      if (e.pointerType === "touch") {
        touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touchPts.size === 2) {
          touched.current = true;
          cancelRef.current();
          const [a, b] = [...touchPts.values()];
          const r = rectOf();
          const mx = (a.x + b.x) / 2 - r.left;
          const my = (a.y + b.y) / 2 - r.top;
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: cam.current.s, wx: (mx - cam.current.x) / cam.current.s, wy: (my - cam.current.y) / cam.current.s };
          // a lone finger that was already panning hands over to the pinch
          drag.id = -1;
          panning.current = true;
          area.dataset.panning = "true";
          drag.moved = 99;
          anchor.current = null;
          tgt.current = { ...cam.current };
          return;
        }
      }
      const middle = e.button === 1;
      const grab = middle || (e.button === 0 && (space || grabRef.current || !onStub(e.target)));
      if (middle) e.preventDefault(); // no browser autoscroll
      if (!grab || drag.id !== -1 || pinch) return;
      touched.current = true;
      drag.id = e.pointerId;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved = 0;
      panning.current = true;
      area.dataset.panning = "true";
      try {
        area.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
      anchor.current = null;
      tgt.current = { ...cam.current };
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" && touchPts.has(e.pointerId)) {
        const prev = touchPts.get(e.pointerId)!;
        touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && touchPts.size >= 2) {
          const [a, b] = [...touchPts.values()];
          const r = rectOf();
          const mx = (a.x + b.x) / 2 - r.left;
          const my = (a.y + b.y) / 2 - r.top;
          const s = clamp(pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), MIN_SCALE, MAX_SCALE);
          jump({ s, x: mx - pinch.wx * s, y: my - pinch.wy * s });
          return;
        }
        if (drag.id === e.pointerId) {
          drag.moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
          jump({ ...cam.current, x: cam.current.x + (e.clientX - prev.x), y: cam.current.y + (e.clientY - prev.y) });
        }
        return;
      }
      if (e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      jump({ ...cam.current, x: cam.current.x + dx, y: cam.current.y + dy });
    };
    const onUp = (e: PointerEvent) => {
      touchPts.delete(e.pointerId);
      if (pinch && touchPts.size < 2) {
        pinch = null;
        drag.id = -1;
        if (!touchPts.size) stop();
        else {
          // the finger left standing carries on as a pan
          const [[id, p]] = [...touchPts.entries()];
          drag.id = id;
          drag.x = p.x;
          drag.y = p.y;
        }
        return;
      }
      if (e.pointerId !== drag.id) return;
      drag.id = -1;
      stop();
      try {
        area.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    // a drag that moved is not a click
    const onClickCap = (e: MouseEvent) => {
      if (drag.moved > 4) {
        drag.moved = 0;
        e.stopPropagation();
        e.preventDefault();
      }
    };
    const noMiddle = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    const onDbl = (e: MouseEvent) => {
      if (!onStub(e.target) && !onUi(e.target)) fit();
    };

    // keys, while the board has focus
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || onUi(e.target)) return;
      touched.current = true;
      const pan = (dx: number, dy: number) => {
        const k = e.shiftKey ? 3 : 1;
        glide({ ...tgt.current, x: tgt.current.x + dx * k, y: tgt.current.y + dy * k });
      };
      let handled = true;
      if (e.key === "+" || e.key === "=") zoomBy(KEY_STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / KEY_STEP);
      else if (e.key === "0") fit();
      else if (e.target === area && e.key === "ArrowLeft") pan(PAN_STEP, 0);
      else if (e.target === area && e.key === "ArrowRight") pan(-PAN_STEP, 0);
      else if (e.target === area && e.key === "ArrowUp") pan(0, PAN_STEP);
      else if (e.target === area && e.key === "ArrowDown") pan(0, -PAN_STEP);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onSpaceDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && t !== area && !area.contains(t)) return;
      if (!hover && t !== area) return;
      if (t?.closest("button, a, [role='radio'], [role='tab']")) return;
      e.preventDefault();
      space = true;
      setMode();
    };
    const onSpaceUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      space = false;
      setMode();
    };
    const onEnter = () => {
      hover = true;
      setMode();
    };
    const onLeave = () => {
      hover = false;
      setMode();
    };
    const onBlur = () => {
      space = false;
      setMode();
    };
    const noNativeDrag = (e: Event) => e.preventDefault(); // no ghost image from a link or a picture

    area.addEventListener("wheel", onWheel, { passive: false });
    area.addEventListener("pointerdown", onDown, true);
    area.addEventListener("pointermove", onMove);
    area.addEventListener("pointerup", onUp);
    area.addEventListener("pointercancel", onUp);
    area.addEventListener("click", onClickCap, true);
    area.addEventListener("auxclick", noMiddle);
    area.addEventListener("mousedown", noMiddle);
    area.addEventListener("dblclick", onDbl);
    area.addEventListener("keydown", onKey);
    area.addEventListener("pointerenter", onEnter);
    area.addEventListener("pointerleave", onLeave);
    area.addEventListener("dragstart", noNativeDrag);
    window.addEventListener("keydown", onSpaceDown);
    window.addEventListener("keyup", onSpaceUp);
    window.addEventListener("blur", onBlur);
    return () => {
      area.removeEventListener("wheel", onWheel);
      area.removeEventListener("pointerdown", onDown, true);
      area.removeEventListener("pointermove", onMove);
      area.removeEventListener("pointerup", onUp);
      area.removeEventListener("pointercancel", onUp);
      area.removeEventListener("click", onClickCap, true);
      area.removeEventListener("auxclick", noMiddle);
      area.removeEventListener("mousedown", noMiddle);
      area.removeEventListener("dblclick", onDbl);
      area.removeEventListener("keydown", onKey);
      area.removeEventListener("pointerenter", onEnter);
      area.removeEventListener("pointerleave", onLeave);
      area.removeEventListener("dragstart", noNativeDrag);
      window.removeEventListener("keydown", onSpaceDown);
      window.removeEventListener("keyup", onSpaceUp);
      window.removeEventListener("blur", onBlur);
      delete area.dataset.space;
      stop();
    };
  }, [areaRef, zoomAt, jump, glide, zoomBy, fit]);

  return useMemo(() => ({ fit, fitNow, measure, zoomBy, scale, panning, touched }), [fit, fitNow, measure, zoomBy, scale]);
}
