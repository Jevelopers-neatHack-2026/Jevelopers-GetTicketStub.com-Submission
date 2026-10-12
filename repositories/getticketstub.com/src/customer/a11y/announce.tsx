"use client";
// ONE polite live region per screen (GT-11.2). Screens keep their messages visible as plain text; nothing else on a
// page is a live region, so a screen reader hears one calm voice, in order. Two ways to speak:
//   - mark the visible message `data-announce`: when it appears or its words change, the one region says it
//     (`data-announce="added"` on a log, like the agent chat, says only what was added; `data-announce="change"` stays
//     quiet when it first appears and speaks only when its words change afterwards, for a line that is always there);
//   - call announce(text) / useAnnounce(text) from code.
// <LiveRegion/> is mounted once, in NavFrame.
import { useEffect, useRef, useSyncExternalStore } from "react";
import s from "./a11y.module.css";

interface Line {
  n: number;
  text: string;
}

let line: Line = { n: 0, text: "" };
let clearTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Say it once, politely. The same words twice in a row are heard twice; the region empties after a few seconds. */
export function announce(text: string): void {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;
  line = { n: line.n + 1, text: clean };
  emit();
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    line = { n: line.n, text: "" };
    emit();
  }, 8000);
}

function useLine(): Line {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => line,
    () => line,
  );
}

const textOf = (el: Element | Node) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** Watches the page for `data-announce` messages appearing or changing, and sends their words to announce(). */
function useWatchMarked(region: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const queued = new Map<Element, string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queue = (el: Element | null, words?: string) => {
      if (!el || el.closest("[aria-hidden='true'], [data-live-region]") || el.closest("[inert]")) return;
      const log = el.getAttribute("data-announce") === "added";
      const said = log ? (words ?? "") : textOf(el);
      if (!said) return;
      queued.set(el, log ? `${queued.get(el) ?? ""} ${said}`.trim() : said);
      if (timer) clearTimeout(timer);
      // a beat to let one change settle (a message and its undo link arrive together), then one announcement
      timer = setTimeout(() => {
        const all = [...queued.values()];
        queued.clear();
        timer = null;
        announce(all.join(" "));
      }, 180);
    };
    const near = (node: Node | null): Element | null => (node instanceof Element ? node : node?.parentElement ?? null)?.closest("[data-announce]") ?? null;
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (region.current?.contains(r.target)) continue;
        if (r.type === "characterData") queue(near(r.target));
        else {
          const host = near(r.target);
          for (const added of r.addedNodes) {
            if (added.nodeType === 3) queue(host, textOf(added));
            else if (added instanceof Element) {
              const fresh = (el: Element) => el.getAttribute("data-announce") !== "change";
              if (host) queue(host, textOf(added));
              else if (added.matches("[data-announce]")) {
                if (fresh(added)) queue(added, textOf(added));
              } else {
                added.querySelectorAll("[data-announce]").forEach((el) => {
                  if (fresh(el)) queue(el, textOf(el));
                });
              }
            }
          }
          if (!r.addedNodes.length && host) queue(host); // words removed: the line now says something shorter
        }
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => {
      mo.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [region]);
}

/** The single live region. Mount it once per app (NavFrame does). */
export function LiveRegion() {
  const { n, text } = useLine();
  const ref = useRef<HTMLDivElement>(null);
  useWatchMarked(ref);
  // A fresh child per announcement makes a repeat of the same words get read again.
  return (
    <div ref={ref} className={s.live} role="status" aria-live="polite" aria-atomic="true" data-live-region>
      {text ? <span key={n}>{text}</span> : null}
    </div>
  );
}

/** Announce `text` whenever it changes to something new. Empty text says nothing. */
export function useAnnounce(text: string | null | undefined): void {
  useEffect(() => {
    if (text) announce(text);
  }, [text]);
}
