"use client";
// The cutting mat's camera. One state, {x, y, s}, is the whole truth: it drives the transform on the
// world layer (the stub), the grid on the mat and both inch rulers. It lives in a ref and is painted
// from requestAnimationFrame, so zooming and panning never re-render React.
//
//   screen = camera.xy + world * camera.s      (world = px at "fit", measured from the area's top left)
//
// Inputs: wheel and pinch zoom around the pointer; two-finger trackpad scroll, middle-drag, space +
// drag, empty-mat drag and touch drag pan; + - 0 and arrows from the keyboard; double-click fits.
import { useCallback, useEffect, useRef, type RefObject } from "react";

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
const KEY_STEP = 1.25;
const PAN_STEP = 64;
const KEEP_PX = 64; // how much of the stub must stay on the mat
const EASE_MS = 70; // time constant of the eased zoom
const MIN_LABEL_PX = 100; // the closest two ruler numbers may sit
/** Ruler steps in inches. Each also sets the grid: major lines every step, fine lines every quarter (fifth from 5 up). */
const STEPS = [0.25, 0.5, 1, 2, 5, 10];

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
interface Metrics {
  ox: number;
  oy: number;
  fw: number;
  fh: number;
  inch: number;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* ---- Wheel classification -------------------------------------------------------------------
   A browser gives no flag that says "mouse" or "trackpad", so we infer it, most certain evidence
   first, and latch the answer for the burst (reset after 300 ms of quiet):
   1. ctrlKey                     -> pinch (trackpads send pinch as ctrl+wheel). Zoom, proportional.
   2. deltaMode line or page      -> mouse wheel (Firefox, some Linux setups). Zoom.
   3. wheelDeltaY a multiple of 120 that is not -3 x deltaY -> notched mouse wheel. Zoom.
   4. Fractional deltas, or deltaX without shift -> trackpad (a mouse never does either). Pan.
   5. |deltaY| a whole multiple of 100, arriving after a pause -> notched mouse wheel. Zoom.
   6. Anything else keeps the latched device; the first event of a burst falls back to the
      platform default: pan on macOS (small whole deltas are almost always a trackpad there), zoom
      everywhere else. So a mouse wheel zooms unless the device has already proved it is a trackpad. */
type Device = "wheel" | "pad";

export interface CameraApi {
  /** Animate back to fit. */
  fit: () => void;
  /** Zoom about the middle of the mat, by a factor. */
  zoomBy: (factor: number) => void;
  /** True while a drag-pan is running, so other pointer gestures on the mat stand down. */
  panning: RefObject<boolean>;
}

interface Opts {
  enabled: boolean;
  matRef: RefObject<HTMLElement | null>;
  areaRef: RefObject<HTMLElement | null>;
  /** Changes whenever the stub's size on the mat may have changed (style, stock). */
  layoutKey: string;
  /** The stub's printed width in inches for an edition. */
  inchesWide: (edition: string) => number;
  numClass: string;
  /** Another gesture (a stub swipe) must give way, as a second finger landed. */
  onCancelGesture: () => void;
}

export function useCamera({ enabled, matRef, areaRef, layoutKey, inchesWide, numClass, onCancelGesture }: Opts): CameraApi {
  const cam = useRef<Cam>({ x: 0, y: 0, s: 1 });
  const tgt = useRef<Cam>({ x: 0, y: 0, s: 1 });
  const anchor = useRef<Anchor | null>(null);
  const met = useRef<Metrics>({ ox: 0, oy: 0, fw: 0, fh: 0, inch: 180 });
  const raf = useRef(0);
  const last = useRef(0);
  const idle = useRef(0);
  const panning = useRef(false);
  const cancelRef = useRef(onCancelGesture);
  useEffect(() => {
    cancelRef.current = onCancelGesture;
  });
  const els = useRef<{ world: HTMLElement | null; body: HTMLElement | null; top: HTMLElement | null; left: HTMLElement | null; bandT: HTMLElement | null; bandL: HTMLElement | null; pct: HTMLElement | null; fitBtn: HTMLElement | null }>({
    world: null, body: null, top: null, left: null, bandT: null, bandL: null, pct: null, fitBtn: null,
  });

  /* ---------- painting ---------- */
  const paint = useCallback(() => {
    const e = els.current;
    const area = areaRef.current;
    if (!e.world || !e.body || !area) return;
    const { x, y, s } = cam.current;
    const m = met.current;
    e.world.style.transform = `translate(${x}px, ${y}px) scale(${s})`;

    const P = m.inch * s;
    const step = STEPS.find((st) => st * P >= MIN_LABEL_PX) ?? STEPS[STEPS.length - 1];
    const gx = step * P;
    const gf = gx / (step >= 5 ? 5 : 4);
    const sub = gx / (step >= 5 ? 10 : 8);
    const sx = x + m.ox * s;
    const sy = y + m.oy * s;

    e.body.style.backgroundSize = `${gx}px 100%, 100% ${gx}px, ${gf}px 100%, 100% ${gf}px`;
    e.body.style.backgroundPosition = `${sx}px 0, 0 ${sy}px, ${sx}px 0, 0 ${sy}px`;
    if (e.top) {
      e.top.style.backgroundSize = `${gx}px 12px, ${gx / 2}px 8px, ${sub}px 4px`;
      e.top.style.backgroundPosition = `${sx}px 100%, ${sx}px 100%, ${sx}px 100%`;
    }
    if (e.left) {
      e.left.style.backgroundSize = `12px ${gx}px, 8px ${gx / 2}px, 4px ${sub}px`;
      e.left.style.backgroundPosition = `100% ${sy}px, 100% ${sy}px, 100% ${sy}px`;
    }
    if (e.bandT) {
      e.bandT.style.left = `${sx}px`;
      e.bandT.style.width = `${m.fw * s}px`;
    }
    if (e.bandL) {
      e.bandL.style.top = `${sy}px`;
      e.bandL.style.height = `${m.fh * s}px`;
    }

    const fmt = (i: number, zero: string) => {
      if (i === 0) return zero;
      const v = Math.round(i * step * 1000) / 1000;
      return (v < 0 ? "−" : "") + String(Math.abs(v));
    };
    const labels = (host: HTMLElement | null, origin: number, length: number, axis: "x" | "y") => {
      if (!host) return;
      const lo = Math.floor(-origin / gx);
      const hi = Math.ceil((length - origin) / gx);
      const count = Math.max(0, hi - lo + 1);
      const keep = host.querySelectorAll(":scope > [data-n]");
      for (let k = keep.length; k < count; k++) {
        const el = document.createElement("span");
        el.className = numClass;
        el.dataset.n = "";
        host.appendChild(el);
      }
      const nodes = host.querySelectorAll<HTMLElement>(":scope > [data-n]");
      nodes.forEach((el, k) => {
        if (k >= count) {
          el.remove();
          return;
        }
        const i = lo + k;
        const text = fmt(i, axis === "x" ? "0 in" : "0");
        if (el.textContent !== text) el.textContent = text;
        const p = origin + i * gx;
        el.style.transform = axis === "x" ? `translateX(${p}px)` : `translateY(${p}px)`;
      });
    };
    labels(e.top, sx, e.body.clientWidth, "x");
    labels(e.left, sy, e.body.clientHeight, "y");

    const pct = Math.round(s * 100);
    if (e.pct && e.pct.textContent !== `${pct}%`) e.pct.textContent = `${pct}%`;
    if (e.fitBtn) e.fitBtn.dataset.fit = Math.abs(s - 1) < 0.001 && Math.abs(x) < 0.5 && Math.abs(y) < 0.5 ? "true" : "false";
    window.dispatchEvent(new Event("ts-camera"));
  }, [areaRef, numClass]);

  /* ---------- the loop ---------- */
  const flagMoving = useCallback(() => {
    const w = els.current.world;
    if (!w) return;
    // will-change keeps a drag cheap, but is dropped at rest so the stub is re-sharpened at its new size
    w.dataset.moving = "true";
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => delete w.dataset.moving, 160);
  }, []);

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

  /** Keep part of the stub on the mat. */
  const bound = useCallback(
    (c: Cam): Cam => {
      const area = areaRef.current;
      if (!area) return c;
      const m = met.current;
      const aw = area.clientWidth;
      const ah = area.clientHeight;
      const keepX = Math.min(KEEP_PX, m.fw * c.s * 0.5);
      const keepY = Math.min(KEEP_PX, m.fh * c.s * 0.5);
      const loX = keepX - m.ox * c.s - m.fw * c.s;
      const hiX = aw - keepX - m.ox * c.s;
      const loY = keepY - m.oy * c.s - m.fh * c.s;
      const hiY = ah - keepY - m.oy * c.s;
      return { s: c.s, x: loX > hiX ? c.x : clamp(c.x, loX, hiX), y: loY > hiY ? c.y : clamp(c.y, loY, hiY) };
    },
    [areaRef],
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

  const centre = useCallback((): [number, number] => {
    const a = areaRef.current;
    return a ? [a.clientWidth / 2, a.clientHeight / 2] : [0, 0];
  }, [areaRef]);

  const fit = useCallback(() => glide({ x: 0, y: 0, s: 1 }), [glide]);
  const zoomBy = useCallback(
    (f: number) => {
      const [px, py] = centre();
      zoomAt(px, py, f);
    },
    [centre, zoomAt],
  );

  /* ---------- measuring: the stub's real size on the mat, so the grid is in true inches ---------- */
  useEffect(() => {
    if (!enabled) return;
    const mat = matRef.current;
    const body = mat?.querySelector<HTMLElement>("[data-cam-body]") ?? null;
    if (!mat || !body) return;
    els.current = {
      world: mat.querySelector("[data-cam-world]"),
      body,
      top: mat.querySelector("[data-cam-top]"),
      left: mat.querySelector("[data-cam-left]"),
      bandT: mat.querySelector("[data-cam-band-t]"),
      bandL: mat.querySelector("[data-cam-band-l]"),
      pct: document.querySelector("[data-cam-pct]"),
      fitBtn: document.querySelector("[data-cam-fit]"),
    };
    let r = 0;
    const until = performance.now() + 1000;
    const measure = () => {
      const fig = body.querySelector<HTMLElement>("[data-card] figure[data-edition]");
      if (!fig) return;
      const { x, y, s } = cam.current;
      const fr = fig.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      const next = {
        inch: fr.width / s / (inchesWide(fig.dataset.edition ?? "") || 2),
        ox: (fr.left - br.left - x) / s,
        oy: (fr.top - br.top - y) / s,
        fw: fr.width / s,
        fh: fr.height / s,
      };
      const p = met.current;
      if ((Object.keys(next) as (keyof Metrics)[]).every((k) => Math.abs(p[k] - next[k]) < 0.5)) return;
      met.current = next;
      paint();
    };
    const tick = () => {
      measure();
      if (performance.now() < until) r = requestAnimationFrame(tick);
    };
    r = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => {
      measure();
      paint();
    });
    ro.observe(body);
    return () => {
      cancelAnimationFrame(r);
      ro.disconnect();
    };
  }, [enabled, matRef, layoutKey, inchesWide, paint]);

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
    if (!enabled) return;
    const area = areaRef.current;
    if (!area) return;
    const rectOf = () => area.getBoundingClientRect();
    const onStub = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("[data-stub-area]");
    const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");

    // wheel
    const dev = { kind: (isMac() ? "pad" : "wheel") as Device, at: 0 };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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
        jump(bound({ ...cam.current, x: cam.current.x - dx }));
      } else if (dev.kind === "pad") {
        jump(bound({ ...cam.current, x: cam.current.x - dx, y: cam.current.y - dy }));
      } else {
        // the step is proportional to the notch, so one notch is about 22%
        zoomAt(px, py, Math.exp(-clamp(dy, -240, 240) * 0.002));
      }
    };

    // drag
    let space = false;
    let hover = false;
    const drag = { id: -1, x: 0, y: 0, moved: 0, kind: "" };
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; s: number; mx: number; my: number; wx: number; wy: number } | null = null;
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
      if (e.pointerType === "touch") {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          cancelRef.current();
          const [a, b] = [...touches.values()];
          const r = rectOf();
          const mx = (a.x + b.x) / 2 - r.left;
          const my = (a.y + b.y) / 2 - r.top;
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: cam.current.s, mx, my, wx: (mx - cam.current.x) / cam.current.s, wy: (my - cam.current.y) / cam.current.s };
          panning.current = true;
          area.dataset.panning = "true";
          drag.moved = 99;
          return;
        }
      }
      const middle = e.button === 1;
      const grab = middle || (e.button === 0 && (space || (!onStub(e.target) && !(e.target as HTMLElement).closest("[role='toolbar'], a, input, textarea, button"))));
      if (middle) e.preventDefault(); // no browser autoscroll
      if (!grab || drag.id !== -1 || pinch) return;
      drag.id = e.pointerId;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved = 0;
      drag.kind = middle ? "middle" : "left";
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
      if (e.pointerType === "touch" && touches.has(e.pointerId)) {
        const prev = touches.get(e.pointerId)!;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && touches.size >= 2) {
          const [a, b] = [...touches.values()];
          const r = rectOf();
          const mx = (a.x + b.x) / 2 - r.left;
          const my = (a.y + b.y) / 2 - r.top;
          const s = clamp(pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), MIN_SCALE, MAX_SCALE);
          jump({ s, x: mx - pinch.wx * s, y: my - pinch.wy * s });
          return;
        }
        if (drag.id === e.pointerId) {
          drag.moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
          jump(bound({ ...cam.current, x: cam.current.x + (e.clientX - prev.x), y: cam.current.y + (e.clientY - prev.y) }));
        }
        return;
      }
      if (e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      jump(bound({ ...cam.current, x: cam.current.x + dx, y: cam.current.y + dy }));
    };
    const onUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (pinch && touches.size < 2) {
        pinch = null;
        drag.id = -1;
        if (!touches.size) stop();
        else {
          // the finger left standing carries on as a pan
          const [[id, p]] = [...touches.entries()];
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
    // a drag that moved is not a click; a plain click on the empty mat still deselects
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
      if (!onStub(e.target) && !(e.target as HTMLElement).closest("[role='toolbar'], a, input, textarea, button")) fit();
    };

    // keys, while the mat has focus
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const c = cam.current;
      const moved = Math.abs(c.s - 1) > 0.001 || Math.abs(c.x) > 0.5 || Math.abs(c.y) > 0.5;
      const pan = (dx: number, dy: number) => {
        const k = e.shiftKey ? 3 : 1;
        glide(bound({ ...tgt.current, x: tgt.current.x + dx * k, y: tgt.current.y + dy * k }));
      };
      let handled = true;
      if (e.key === "+" || e.key === "=") zoomBy(KEY_STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / KEY_STEP);
      else if (e.key === "0") fit();
      // at fit the arrows keep dealing styles; once the camera has moved (or with shift) they pan
      else if (e.key === "ArrowLeft" && (moved || e.shiftKey)) pan(PAN_STEP, 0);
      else if (e.key === "ArrowRight" && (moved || e.shiftKey)) pan(-PAN_STEP, 0);
      else if (e.key === "ArrowUp" && (moved || e.shiftKey)) pan(0, PAN_STEP);
      else if (e.key === "ArrowDown" && (moved || e.shiftKey)) pan(0, -PAN_STEP);
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
      window.removeEventListener("keydown", onSpaceDown);
      window.removeEventListener("keyup", onSpaceUp);
      window.removeEventListener("blur", onBlur);
      delete area.dataset.space;
      stop();
    };
  }, [enabled, areaRef, zoomAt, jump, bound, glide, zoomBy, fit]);

  return { fit, zoomBy, panning };
}
