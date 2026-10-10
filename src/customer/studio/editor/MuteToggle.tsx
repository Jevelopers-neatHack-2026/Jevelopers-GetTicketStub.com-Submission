"use client";
import { useMuted } from "@/customer/studio/feedback";
import styles from "./overlays.module.css";

/** Sound is on by default; this is the visible way to turn it off. */
export function MuteToggle({ className }: { className?: string }) {
  const [muted, setMuted] = useMuted();
  return (
    <button
      type="button"
      className={`${styles.iconBtn} ${className ?? ""}`}
      aria-pressed={muted}
      aria-label={muted ? "Sound off. Turn sound on" : "Sound on. Mute"}
      title={muted ? "Turn sound on" : "Mute"}
      onClick={() => setMuted(!muted)}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9v6h4l5 4V5L8 9H4z" />
        {muted ? (
          <path d="M17 9l5 6M22 9l-5 6" />
        ) : (
          <>
            <path d="M16.5 8.5a5 5 0 0 1 0 7" />
            <path d="M19 6a8.5 8.5 0 0 1 0 12" />
          </>
        )}
      </svg>
    </button>
  );
}
