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

// Stage moments (a stub lifted under the lamp, the tear, the printing stage, the finish picker) dim the nav
// to the night palette with a 600 ms fade, but it stays usable. Ref-counted, so two stages overlapping
// never lift the lights early.
let stagers = 0;

/** While `active`, the nav switches to the stage palette. Sets data-nav-stage on <html>; NavFrame reads it in CSS. */
export function useNavStage(active: boolean) {
  useEffect(() => {
    if (!active) return;
    stagers += 1;
    document.documentElement.setAttribute("data-nav-stage", "");
    return () => {
      stagers -= 1;
      if (stagers <= 0) {
        stagers = 0;
        document.documentElement.removeAttribute("data-nav-stage");
      }
    };
  }, [active]);
}

/** The old name, kept so callers still compile. */
export const useNavHidden = useNavStage;

const DESKTOP = "(min-width: 960px)";

/** True from 960px up. False on the server, so the phone layout is the first paint. */
export function useDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(DESKTOP);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
}
