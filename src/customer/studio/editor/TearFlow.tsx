"use client";
import Link from "next/link";
import { useEffect } from "react";
import type { Stub } from "../types";
import { encodeStub } from "../store";
import { TearGesture } from "@/customer/studio/stub/TearGesture";
import { Sheet } from "./Sheet";
import { ctaLabel } from "./MaterialPicker";
import styles from "./overlays.module.css";

/** Full-screen night stage for the tear. */
export function TearStage({ stub, onTorn, onCancel }: { stub: Stub; onTorn: () => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className={`ts-night ${styles.tearStage}`} role="dialog" aria-modal="true" aria-label="Tear to finish">
      <p className={styles.tearHint}>Drag along the perforation to tear it off.</p>
      <div className={styles.tearArea}>
        <TearGesture stub={stub} onTorn={onTorn} />
      </div>
      <button type="button" className="btn" onClick={onCancel}>
        Not yet
      </button>
    </div>
  );
}

/** After the tear: share it, print it, or put it in the wallet. */
export function FinishSheet({ stub, open, onClose }: { stub: Stub; open: boolean; onClose: () => void }) {
  return (
    <Sheet title="Pinned to your wall" open={open} onClose={onClose}>
      <div className={styles.stack}>
        <p className={styles.muted}>Your stub is finished. Share it, print it or keep it on your phone.</p>
        <Link className="btn btn-primary btn-block" href={`/s/${encodeStub(stub)}`}>
          Share your stub
        </Link>
        <Link className="btn btn-block" href={`/checkout/${stub.id}`}>
          {ctaLabel(stub.material)}
        </Link>
        <Link className="btn btn-block" href={`/wallet/${stub.id}`}>
          Add to wallet
        </Link>
        <Link className={styles.textLink} href="/wall">
          See your wall
        </Link>
      </div>
    </Sheet>
  );
}
