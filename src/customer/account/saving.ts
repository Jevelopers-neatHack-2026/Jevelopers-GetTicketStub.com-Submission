"use client";
// Whether the server can save anything. It can't on a preview with no writable disk: every storage route then
// answers 503 `storage_unavailable`. Once seen, the account layer treats it as "saving is off": no sign-in prompts,
// no sync, local-only shares and orders. Read once per page load from /api/auth/me, and flipped by any 503.
import { useSyncExternalStore } from "react";

export const SAVING_OFF_CODE = "storage_unavailable";
export const SAVING_OFF_LINE = "Saving is off on this preview. Your stubs stay on this device.";

let off = false;
const listeners = new Set<() => void>();

export function markSavingOff() {
  if (off) return;
  off = true;
  listeners.forEach((l) => l());
}

export const isSavingOff = () => off;

export function useSavingOff(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => off,
    () => false,
  );
}
