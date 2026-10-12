"use client";
// The demo-preview notice as a small yellow pill floating in the bottom-left of the page. It reads
// "Demo"; hovering (or focusing, or tapping on a phone) unrolls the rest, and × puts it away for the
// rest of the visit. It comes back next visit: the preview should never pass for the real thing.
import { useState, useSyncExternalStore } from "react";
import { haptic, play } from "@/customer/studio/feedback";
import p from "./DemoPill.module.css";

const KEY = "ticketstub.demoPill";
const listeners = new Set<() => void>();
let hidden = false; // closed this load, even when storage is off

function readClosed(): boolean {
  if (hidden) return true;
  try {
    return window.sessionStorage.getItem(KEY) === "closed";
  } catch {
    return false;
  }
}

function useClosed(): [boolean, () => void] {
  const closed = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readClosed,
    () => false,
  );
  const close = () => {
    try {
      window.sessionStorage.setItem(KEY, "closed");
    } catch {
      /* storage off: it still hides until the next load */
    }
    hidden = true;
    listeners.forEach((l) => l());
  };
  return [closed, close];
}

export function DemoPill() {
  const [closed, close] = useClosed();
  const [open, setOpen] = useState(false);
  if (closed) return null;

  const toggle = (next: boolean) => {
    if (next === open) return;
    setOpen(next);
    play(next ? "open" : "close", { emphasis: "subtle" });
  };

  return (
    <aside
      className={p.pill}
      data-open={open || undefined}
      aria-label="Demo preview"
      onPointerEnter={(e) => e.pointerType === "mouse" && toggle(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && toggle(false)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && toggle(false)}
    >
      <button
        type="button"
        className={p.tag}
        aria-expanded={open}
        aria-controls="demo-pill-more"
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && toggle(true)}
        onClick={(e) => {
          // a mouse already opened it on hover; a tap or a key toggles
          if (e.detail === 0 || (e.nativeEvent as PointerEvent).pointerType !== "mouse") toggle(!open);
        }}
      >
        Demo
      </button>
      <span className={p.more} id="demo-pill-more">
        <span className={p.inner}>
          <span className={p.text}>Sample events and art · Sandbox checkout</span>
          <button
            type="button"
            className={p.close}
            aria-label="Hide the demo notice"
            tabIndex={open ? 0 : -1}
            onClick={() => {
              play("close");
              haptic(8);
              close();
            }}
          >
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      </span>
    </aside>
  );
}
