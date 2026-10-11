"use client";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** True after hydration. Local storage reads wait for this so server and client HTML match. */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

export const nowMs = () => Date.now();
export const randomId = (len = 8) => Math.random().toString(36).slice(2, 2 + len);
