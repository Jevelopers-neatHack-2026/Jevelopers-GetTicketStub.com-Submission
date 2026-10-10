"use client";
// The print run: the stage goes dark and every guest's stub feeds out of the printer slot, one after
// another, with the printer running. They pile up under the slot; then "Published" lands.
// Same printer, slot and stage as the fan reveal (research/Printing.tsx), run once per guest.
import { useEffect, useState, type CSSProperties } from "react";
import { useNavHidden } from "@/customer/nav/navState";
import { PaperButton, Stamped, TearLink } from "@/customer/desk/Desk";
import { StubView } from "@/customer/studio/stub/StubView";
import { haptic, play, stopPrint } from "@/customer/studio/feedback";
import type { Stub } from "@/customer/studio/types";
import s from "./printrun.module.css";

const PILE = 6; // stubs kept in the DOM under the slot; older ones have long since left

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function PrintRun({ stubs, names, orderId, onClose, onClaim }: { stubs: Stub[]; names: string[]; orderId: string; onClose: () => void; onClaim: () => void }) {
  useNavHidden(true);
  const n = stubs.length;
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reduced] = useState(reducedMotion);
  // A run of 6 prints leisurely; a run of 200 still ends in about six seconds.
  const per = reduced ? 60 : clamp(Math.round(5600 / Math.max(1, n)), 160, 700);

  useEffect(() => {
    play("print");
    return () => stopPrint();
  }, []);

  useEffect(() => {
    if (done) return;
    if (count >= n) {
      const t = setTimeout(() => {
        stopPrint();
        setDone(true);
        haptic([18, 40, 28]);
      }, reduced ? 200 : per + 350);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => {
        setCount((c) => c + 1);
        haptic(4);
      },
      count === 0 ? 450 : per,
    );
    return () => clearTimeout(t);
  }, [count, n, per, done, reduced]);

  function close(after: () => void) {
    setLeaving(true);
    play("close");
    setTimeout(after, 600);
  }

  const first = Math.max(0, count - PILE);
  const visible = stubs.slice(first, count).map((st, k) => ({ st, i: first + k }));
  const current = count > 0 ? names[count - 1] : "";

  return (
    <section className={`ts-stage desk-surface ${s.stage}`} data-leaving={leaving ? "" : undefined} role="dialog" aria-modal="true" aria-label="Printing every guest's stub" style={{ "--feed": `${Math.min(per * 0.9, 560)}ms` } as CSSProperties}>
      <div className={s.status} role="status" aria-live="polite">
        {done ? <Stamped>Published</Stamped> : <span className={s.count}>{count === 0 ? "Warming up the printer…" : `Printing ${count} of ${n}`}</span>}
      </div>
      <p className={s.guest}>{done ? `${n} ${n === 1 ? "stub" : "stubs"}, one for every guest` : current || " "}</p>

      <div className={s.printer}>
        <div className={s.slot} aria-hidden />
        <div className={s.window}>
          {visible.map(({ st, i }) => {
            const depth = count - 1 - i;
            return (
              <div key={st.id} className={s.sheet} data-fresh={depth === 0 && !done ? "" : undefined} style={{ "--depth": depth, "--r": i % 2 ? 1.6 : -1.4 } as CSSProperties}>
                <StubView stub={st} size="md" />
              </div>
            );
          })}
        </div>
      </div>

      <div className={s.meter} aria-hidden>
        <span style={{ width: `${n ? (count / n) * 100 : 0}%` }} />
      </div>

      {done ? (
        <div className={s.after}>
          <p className={s.summary}>
            Sandbox order <span className={s.num}>{orderId}</span>. No real charge, and nothing went to a printer.
          </p>
          <div className={s.actions}>
            <PaperButton type="button" onClick={() => close(onClose)}>
              Back to the organizer
            </PaperButton>
            <TearLink type="button" onClick={() => close(onClaim)}>
              Share a claim link too
            </TearLink>
          </div>
        </div>
      ) : count > 1 ? (
        <TearLink type="button" onClick={() => setCount(n)}>
          Skip to the end
        </TearLink>
      ) : null}
    </section>
  );
}
