"use client";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** False during server render and hydration, true afterwards. Gate local-storage reads on it. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/** Tracks a media query; false on the server. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
