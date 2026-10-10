"use client";
// The last thing in the tray: a strip of paper on a perforation. It is a new desk part built from
// the same tokens. Pressing sinks it a little and plays the tear cue; the tear itself is TearFlow.
import { useState } from "react";
import { haptic, play } from "@/customer/studio/feedback";
import styles from "./Tray.module.css";

export function TearStrip({ torn, onTear }: { torn: boolean; onTear: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      className={styles.strip}
      data-pressed={pressed}
      data-torn={torn}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onClick={() => {
        if (!torn) {
          play("tear");
          haptic([14, 20, 14]);
        } else {
          play("tap", { emphasis: "subtle" });
        }
        onTear();
      }}
    >
      <span className={styles.stripPerf} aria-hidden="true" />
      <span className={styles.stripLabel}>{torn ? "On your wall · Share or print" : "Tear to finish"}</span>
      <svg className={styles.stripCut} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12h18" strokeDasharray="2 3" />
        <path d="m14 8 4 4-4 4" />
      </svg>
    </button>
  );
}
