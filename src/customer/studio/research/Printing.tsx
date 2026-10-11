"use client";
// Night-stage printing reveal: the stub feeds out of a printer slot while researched facts drift in.
// Tap a fact card to keep it on the stub. Minimum 2.5s on screen, then a shutter flash and onDone.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { newStub } from "../fixtures";
import type { EventData, Fact } from "../types";
import { StubView } from "@/customer/studio/stub/StubView";
import { haptic, play, stopPrint } from "@/customer/studio/feedback";
import { researchEvent } from "./client";
import styles from "./Printing.module.css";

const MIN_MS = 2500;
const STAGGER_MS = 450;
const DWELL_MS = 1600;
const TAP_EXTEND_MS = 1500;
const SKIP_AFTER_MS = 3000;
const SHUTTER_MS = 320;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

const keyOf = (f: Fact, i: number) => `${f.id}-${i}`;

/** Push the auto-advance deadline out so a person can finish tapping facts (event-time only). */
function extendDeadline(ref: { current: number }) {
  ref.current = Math.max(ref.current, Date.now() + TAP_EXTEND_MS);
}

export function Printing(props: {
  input: { url?: string; query?: string; event?: EventData };
  onDone: (event: EventData) => void;
  onError: (message: string) => void;
}) {
  const { input } = props;
  const reduced = usePrefersReducedMotion();
  const [event, setEvent] = useState<EventData | undefined>(input.event);
  const [staggered, setShown] = useState(0);
  const [kept, setKept] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((input.event?.facts ?? []).map((f, i) => [keyOf(f, i), !!f.kept])),
  );
  const [showSkip, setShowSkip] = useState(false);
  const [flash, setFlash] = useState(false);

  // Refs mirror state for the finish timer (no stale closures).
  const onDoneRef = useRef(props.onDone);
  const onErrorRef = useRef(props.onError);
  const eventRef = useRef(event);
  const keptRef = useRef(kept);
  const shownRef = useRef(0);
  const reducedRef = useRef(reduced);
  useLayoutEffect(() => {
    onDoneRef.current = props.onDone;
    onErrorRef.current = props.onError;
    eventRef.current = event;
    keptRef.current = kept;
    shownRef.current = reduced ? (event?.facts.length ?? 0) : staggered;
    reducedRef.current = reduced;
  });
  const startRef = useRef(0);
  const deadlineRef = useRef(0);
  const skipRef = useRef(false);
  const finishingRef = useRef(false);

  // Printer sound, skip link, finish checker.
  useEffect(() => {
    startRef.current = Date.now();
    finishingRef.current = false;
    try {
      play("print");
    } catch {
      /* sound is optional */
    }
    const skipTimer = window.setTimeout(() => setShowSkip(true), SKIP_AFTER_MS);
    let doneTimer: number | undefined;

    const finish = () => {
      const ev = eventRef.current;
      if (!ev || finishingRef.current) return;
      finishingRef.current = true;
      try {
        stopPrint();
        play("done");
        haptic([18, 40, 28]);
      } catch {
        /* feedback is optional */
      }
      setFlash(true);
      const final: EventData = {
        ...ev,
        facts: ev.facts.map((f, i) => ({ ...f, kept: !!keptRef.current[keyOf(f, i)] })),
      };
      doneTimer = window.setTimeout(() => onDoneRef.current(final), reducedRef.current ? 0 : SHUTTER_MS);
    };

    const tick = window.setInterval(() => {
      const ev = eventRef.current;
      if (!ev || finishingRef.current) return;
      if (skipRef.current) return finish();
      const allShown = shownRef.current >= ev.facts.length;
      if (!allShown) return;
      if (!deadlineRef.current) {
        deadlineRef.current = Math.max(startRef.current + MIN_MS, Date.now() + (reducedRef.current ? 800 : DWELL_MS));
      }
      if (Date.now() >= deadlineRef.current) finish();
    }, 100);

    return () => {
      window.clearTimeout(skipTimer);
      window.clearInterval(tick);
      if (doneTimer && !finishingRef.current) window.clearTimeout(doneTimer);
      try {
        stopPrint();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Research when no event was handed in.
  const url = input.url;
  const query = input.query;
  const hasEvent = !!input.event;
  useEffect(() => {
    if (hasEvent) return;
    let cancelled = false;
    researchEvent({ url, query })
      .then((ev) => {
        if (cancelled) return;
        setKept(Object.fromEntries(ev.facts.map((f, i) => [keyOf(f, i), !!f.kept])));
        setEvent(ev);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        try {
          stopPrint();
        } catch {
          /* ignore */
        }
        onErrorRef.current(err instanceof Error && err.message ? err.message : "We couldn't read that link.");
      });
    return () => {
      cancelled = true;
    };
  }, [url, query, hasEvent]);

  // Stagger fact cards in as they arrive.
  const factCount = event?.facts.length ?? 0;
  // Reduced motion shows every fact at once; otherwise cards stagger in.
  const shown = reduced ? factCount : staggered;
  useEffect(() => {
    if (!factCount || reduced) return;
    if (shown >= factCount) return;
    const t = window.setTimeout(() => {
      setShown((n) => Math.min(n + 1, factCount));
      try {
        play("tick");
      } catch {
        /* optional */
      }
    }, shown === 0 ? 250 : STAGGER_MS);
    return () => window.clearTimeout(t);
  }, [factCount, shown, reduced]);

  const toggle = (k: string) => {
    setKept((m) => ({ ...m, [k]: !m[k] }));
    try {
      play("pin");
      haptic(10);
    } catch {
      /* optional */
    }
    // Give the person time to finish choosing.
    extendDeadline(deadlineRef);
  };

  const preview = useMemo(() => {
    if (!event) return undefined;
    return newStub({ ...event, facts: event.facts.map((f, i) => ({ ...f, kept: !!kept[keyOf(f, i)] })) }, "printing-preview");
  }, [event, kept]);

  const facts = (event?.facts ?? []).slice(0, shown).map((f, i) => ({ f, i }));
  const left = facts.filter((x) => x.i % 2 === 0);
  const right = facts.filter((x) => x.i % 2 === 1);

  const card = ({ f, i }: { f: Fact; i: number }) => {
    const k = keyOf(f, i);
    const on = !!kept[k];
    return (
      <button key={k} type="button" className={styles.card} aria-pressed={on} onClick={() => toggle(k)}>
        <span className={styles.cardTop}>
          <span className={styles.cardLabel}>{f.label}</span>
          {on ? <span className={styles.kept}>Kept ✓</span> : <span className={styles.keep}>Keep</span>}
        </span>
        <span className={styles.cardMeta}>
          <span>{f.source}</span>
          <span className="provenance">{f.provenance}</span>
          {f.confidence < 0.8 && f.provenance !== "pending" ? <span>Unsure</span> : null}
        </span>
      </button>
    );
  };

  return (
    <section className={`ts-night ${styles.stage}`} aria-label="Printing your stub" aria-busy={!flash}>
      <p className={styles.status} role="status" aria-live="polite">
        Building your stub…
      </p>
      <p className={styles.hint}>{shown > 0 ? "Tap a fact to keep it on your stub." : " "}</p>

      <div className={styles.layout}>
        <div className={`${styles.col} ${styles.colLeft}`}>{left.map(card)}</div>

        <div className={styles.center}>
          <div className={styles.printer}>
            <div className={styles.slot} aria-hidden="true" />
            <div className={styles.feedWindow}>
              <div className={`${styles.feed} ${reduced ? styles.reduced : ""}`} key={preview ? "stub" : "placeholder"}>
                {preview ? <StubView stub={preview} size="md" /> : <div className={styles.placeholder} aria-hidden="true" />}
                <div className={`${styles.foil} ${reduced ? styles.reduced : ""}`} aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>

        <div className={`${styles.col} ${styles.colRight}`}>{right.map(card)}</div>
      </div>

      {showSkip && !flash ? (
        <button
          type="button"
          className={styles.skip}
          onClick={() => {
            skipRef.current = true;
          }}
        >
          Skip to the stub
        </button>
      ) : null}

      {flash ? <div className={styles.flash} aria-hidden="true" /> : null}
    </section>
  );
}
