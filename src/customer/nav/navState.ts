"use client";
// Whether the desktop sidebar is open. The choice outside the editor is remembered in localStorage
// (guarded: storage can throw). Inside the editor the sidebar starts as a rail, and opening it there
// lasts only for the visit, so the cutting mat keeps its room next time.
import { useEffect, useSyncExternalStore } from "react";

const KEY = "ticketstub.nav.v1";

function readPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY) !== "rail";
  } catch {
    return true;
  }
}

let prefOpen = readPref();
let studioOpen = false;
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useNavOpen(inStudio: boolean): [boolean, () => void] {
  const open = useSyncExternalStore(
    subscribe,
    () => (inStudio ? studioOpen : prefOpen),
    () => !inStudio,
  );
  const toggle = () => {
    if (inStudio) studioOpen = !studioOpen;
    else {
      prefOpen = !prefOpen;
      try {
        window.localStorage.setItem(KEY, prefOpen ? "open" : "rail");
      } catch {
        /* storage unavailable: the choice lasts for this visit */
      }
    }
    listeners.forEach((l) => l());
  };
  return [open, toggle];
}

// Stage moments (a stub lifted under the lamp, the tear, the finish picker) hide the bar and the sidebar
// handle with a fade. Ref-counted, so two stages overlapping never show the nav early.
let hiders = 0;

/** While `active`, the nav fades out (600 ms). Sets data-nav-hidden on <html>; NavFrame reads it in CSS. */
export function useNavHidden(active: boolean) {
  useEffect(() => {
    if (!active) return;
    hiders += 1;
    document.documentElement.setAttribute("data-nav-hidden", "");
    return () => {
      hiders -= 1;
      if (hiders <= 0) {
        hiders = 0;
        document.documentElement.removeAttribute("data-nav-hidden");
      }
    };
  }, [active]);
}
