"use client";
// A switch drawn as a padlock: the shackle lifts when guests may change the thing, drops when it is locked.
// Same press, sound and haptic rules as the desk Switch; it lives here because only the organizer has locks.
import type { ReactNode } from "react";
import { haptic, play } from "@/customer/studio/feedback";
import s from "./lock.module.css";

export function Padlock({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={s.padlock} data-locked={locked} aria-hidden>
      <g className={s.shackle}>
        <path d="M10.5 14V10.5a5.5 5.5 0 0 1 11 0V14" />
      </g>
      <rect className={s.body} x="6" y="14" width="20" height="14" rx="3" />
      <g className={s.keyhole}>
        <circle cx="16" cy="20.2" r="1.9" />
        <path d="M16 21.5v3" />
      </g>
    </svg>
  );
}

export function LockSwitch({ locked, onChange, children, hint }: { locked: boolean; onChange: (locked: boolean) => void; children: ReactNode; hint?: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={locked}
      className={s.row}
      onClick={() => {
        play("toggle", { direction: locked ? "back" : "forward" });
        haptic(6);
        onChange(!locked);
      }}
    >
      <span className={s.text}>
        <span>{children}</span>
        {hint ? <span className={s.hint}>{hint}</span> : null}
      </span>
      <span className={s.plate} aria-hidden>
        <Padlock locked={locked} />
      </span>
    </button>
  );
}
