"use client";
// Whether the desktop sidebar is open. The choice outside the editor is remembered in localStorage
// (guarded: storage can throw). Inside the editor the sidebar starts as a rail, and opening it there
// lasts only for the visit, so the cutting mat keeps its room next time.
import { useSyncExternalStore } from "react";

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
