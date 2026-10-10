"use client";
// The printing reveal, shared by /new and the start section. It paints no ground of its own: the parent
// supplies the stage (ts-stage desk-surface). The stub feeds out of the printer slot with a slight curl and
// the ink settles, while researched facts arrive as receipt lines. Tap a line to stamp it "Kept".
// Minimum 2.5s on screen, then the ink settles and onDone fires.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { newStub } from "../fixtures";
import type { EventData, Fact } from "../types";
import { StubView } from "@/customer/studio/stub/StubView";
import { haptic, play, stopPrint } from "@/customer/studio/feedback";
import { MarkLegend, SourceMark, Stamped, TearLink } from "@/customer/desk/Desk";
import { researchEvent } from "./client";
import styles from "./Printing.module.css";

const MIN_MS = 2500;
const STAGGER_MS = 450;
const DWELL_MS = 1600;
const TAP_EXTEND_MS = 1500;
const SKIP_AFTER_MS = 3000;
const SETTLE_MS = 750;

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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The headline names what is being looked up, from the event data: "Finding 12 October in Glasgow…". */
function findingLine(event?: EventData): string {
  if (!event) return "Finding your night…";
  const m = event.dateISO ? /^(\d{4})-(\d{2})-(\d{2})/.exec(event.dateISO) : null;
  const date = m && MONTHS[Number(m[2]) - 1] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : "";
  const city = event.city?.trim();
  const place = !city ? "" : /^online$/i.test(city) ? "online" : `in ${city}`;
  if (date && place) return `Finding ${date} ${place}…`;
  if (date) return `Finding ${date}…`;
  if (place) return `Finding the night ${place}…`;
  return `Finding ${event.title}…`;
}

/** Push the auto-advance deadline out so a person can finish tapping facts (event-time only). */
function extendDeadline(ref: { current: number }) {
  ref.current = Math.max(ref.current, Date.now() + TAP_EXTEND_MS);
}

export function Printing(props: {
  input: { url?: string; query?: string; event?: EventData };
  /** Id the finished stub will carry, so the preview prints the same number and art. */
  stubId?: string;
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
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [settling, setSettling] = useState(false);

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
      setSettling(true);
      const final: EventData = {
        ...ev,
        facts: ev.facts.map((f, i) => ({ ...f, kept: !!keptRef.current[keyOf(f, i)] })),
      };
      doneTimer = window.setTimeout(() => onDoneRef.current(final), reducedRef.current ? 0 : SETTLE_MS);
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
    const turningOn = !keptRef.current[k];
    setKept((m) => ({ ...m, [k]: !m[k] }));
    setTouched((m) => ({ ...m, [k]: true }));
    // The "Kept" stamp plays its own thunk; taking a line off is a quiet tap.
    if (!turningOn) {
      try {
        play("tap", { emphasis: "subtle" });
      } catch {
        /* optional */
      }
    } else haptic(10);
    // Give the person time to finish choosing.
    extendDeadline(deadlineRef);
  };

  const preview = useMemo(() => {
    if (!event) return undefined;
    return newStub({ ...event, facts: event.facts.map((f, i) => ({ ...f, kept: !!kept[keyOf(f, i)] })) }, props.stubId ?? "printing-preview");
  }, [event, kept, props.stubId]);

  const lines = (event?.facts ?? []).slice(0, shown).map((f, i) => ({ f, i, k: keyOf(f, i) }));
  const marks = [...new Set(lines.map((l) => l.f.provenance))];
  const allIn = factCount > 0 && shown >= factCount;
  const headline = settling ? "Letting the ink settle…" : allIn ? `Printing ${event?.title ?? "your stub"}…` : findingLine(event);

  return (
    <section className={styles.stage} aria-label="Printing your stub" aria-busy={!settling}>
      <h1 className={styles.headline} key={headline} role="status" aria-live="polite">
        {headline}
      </h1>
      <p className={styles.hint}>{shown > 0 ? "Tap a line to keep it on your stub." : " "}</p>

      <div className={styles.layout}>
        <div className={styles.printer}>
          <div className={styles.slot} aria-hidden="true" />
          <div className={styles.feedWindow}>
            <div className={`${styles.feed} ${reduced ? styles.reduced : ""}`} key={preview ? "stub" : "placeholder"}>
              <div className={`${styles.ink} ${settling ? styles.settling : ""}`}>
                {preview ? <StubView stub={preview} size="md" /> : <div className={styles.placeholder} aria-hidden="true" />}
              </div>
            </div>
          </div>
        </div>

        <div className={`${styles.receipt} ${lines.length ? styles.receiptOn : ""}`} aria-hidden={lines.length ? undefined : true}>
          <p className={`desk-label ${styles.receiptHead}`}>What we found</p>
          <ol className={styles.lines}>
            {lines.map(({ f, k }) => {
              const on = !!kept[k];
              return (
                <li key={k} className={styles.lineItem}>
                  <button type="button" className={styles.line} aria-pressed={on} onClick={() => toggle(k)}>
                    <span className={styles.lineText}>
                      <span className={styles.lineLabel}>
                        {f.label}
                        <SourceMark p={f.provenance} />
                      </span>
                      <span className={styles.lineSource}>
                        {f.source}
                        {f.confidence < 0.8 && f.provenance !== "pending" ? " · unsure" : ""}
                      </span>
                    </span>
                    <span className={styles.lineAction}>
                      {on ? (
                        touched[k] ? (
                          <Stamped>Kept</Stamped>
                        ) : (
                          <span className={styles.keptStatic}>Kept</span>
                        )
                      ) : (
                        <span className={styles.keep}>Keep</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {marks.length ? <MarkLegend marks={marks} /> : null}
        </div>
      </div>

      {showSkip && !settling ? (
        <div className={styles.skip}>
          <TearLink
            onClick={() => {
              skipRef.current = true;
            }}
          >
            Skip to the stub
          </TearLink>
        </div>
      ) : null}
    </section>
  );
}
