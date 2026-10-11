"use client";
// Signature move: tear the stub off along the perforation. Drag the handle (or use arrow keys,
// Enter to finish). A tick + [4] haptic every ~8% crossed; past 60% it rips, flies up and away
// (600ms enter ease), then onTorn() fires once.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Stub } from "../types";
import { haptic, play } from "../feedback";
import { StubView } from "./StubView";
import t from "./TearGesture.module.css";

const RIP_AT = 60;
const TICK_EVERY = 8;
const RESIST = 0.82; // handle covers 82% of the finger's travel: paper resists
const FLY_MS = 600;

const clamp = (v: number) => Math.min(100, Math.max(0, v));
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function TearGesture({ stub, onTorn }: { stub: Stub; onTorn: () => void }) {
  const headingId = useId();
  const [p, setP] = useState(0);
  const [phase, setPhase] = useState<"idle" | "drag" | "settle" | "ripped">("idle");
  const trackRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; p: number; id: number } | null>(null);
  const lastTick = useRef(0);
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTornRef = useRef(onTorn);
  useEffect(() => {
    onTornRef.current = onTorn;
  }, [onTorn]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const rip = useCallback(() => {
    if (done.current) return;
    done.current = true;
    drag.current = null;
    setP(100);
    setPhase("ripped");
    play("tear");
    haptic([30, 30, 60]);
    timer.current = setTimeout(() => onTornRef.current(), reduced() ? 220 : FLY_MS);
  }, []);

  const advance = useCallback(
    (next: number) => {
      if (done.current) return;
      const v = clamp(next);
      const tick = Math.floor(v / TICK_EVERY);
      if (tick > lastTick.current) {
        play("tick");
        haptic([4]);
      }
      lastTick.current = tick;
      setP(v);
      if (v >= RIP_AT) rip();
    },
    [rip],
  );

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (done.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, p, id: e.pointerId };
    setPhase("drag");
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const track = trackRef.current;
    if (!d || d.id !== e.pointerId || !track) return;
    const w = track.getBoundingClientRect().width || 1;
    advance(d.p + ((e.clientX - d.x) / w) * 100 * RESIST);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (done.current) return;
    // not far enough: the paper springs back
    lastTick.current = 0;
    setPhase("settle");
    setP(0);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (done.current) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setPhase("drag");
      advance(p + TICK_EVERY);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setPhase("drag");
      lastTick.current = Math.floor(clamp(p - TICK_EVERY) / TICK_EVERY);
      setP(clamp(p - TICK_EVERY));
    } else if (e.key === "Home") {
      e.preventDefault();
      lastTick.current = 0;
      setPhase("settle");
      setP(0);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      rip();
    }
  };

  const ripped = phase === "ripped";
  // the stub lifts a little as the tear runs, then flies up and away
  const moverTransform = ripped
    ? "translate(14%, -135%) rotate(-14deg)"
    : `translateY(${(-p * 0.08).toFixed(2)}px) rotate(${(-p * 0.03).toFixed(3)}deg)`;
  const pct = Math.round(p);

  return (
    <section className={t.wrap} aria-labelledby={headingId}>
      <h2 id={headingId} className={t.heading}>
        Tear to finish
      </h2>
      <div className={t.stage}>
        <div
          className={`${t.mover} ${ripped ? t.flyAway : phase === "drag" ? t.dragging : t.settling}`}
          style={{ transform: moverTransform }}
        >
          <StubView stub={stub} size="md" />
        </div>
      </div>
      <div className={t.track} ref={trackRef}>
        <span className={`${t.line} ${phase === "settle" ? t.settlingBar : ""}`} aria-hidden="true" style={{ left: `${pct}%` }} />
        <span
          className={`${t.torn} ${phase === "settle" ? t.settlingBar : ""}`}
          aria-hidden="true"
          style={{ width: `${pct}%` }}
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Tear along the perforation"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={ripped ? "Torn" : `${pct}% torn. Tear past ${RIP_AT}% to finish; press Enter to tear.`}
          className={`${t.handle} ${phase === "settle" ? t.settlingBar : ""}`}
          style={{ left: `${pct}%` }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
        >
          <span className={t.grip} aria-hidden="true" />
        </div>
      </div>
      <p className={t.hint}>Drag along the dotted line.</p>
      <span className={t.pct} aria-hidden="true">
        {ripped ? "Torn" : pct > 0 ? `${pct}%` : ""}
      </span>
    </section>
  );
}
