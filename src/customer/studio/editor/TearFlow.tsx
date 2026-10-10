"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavHidden } from "@/customer/nav/navState";
import type { Stub } from "../types";
import { upsertStub } from "../store";
import { TearGesture } from "@/customer/studio/stub/TearGesture";
import { PathTrack } from "@/customer/wayfinding/PathTrack";
import { PaperButton } from "@/customer/desk/Desk";
import styles from "./TearFlow.module.css";

const FADE_MS = 600;

/**
 * Full-screen stage for the tear. The lights go down, you tear the stub off, it flies up and out,
 * and the wall takes over (/wall?pinned=<id> plays the landing and the pin). No sheet, no dimmed
 * editor: the torn state is saved here, so the Editor's onTorn is not needed for the hand-off.
 */
export function TearStage({ stub, onCancel }: { stub: Stub; onTorn: () => void; onCancel: () => void }) {
  useNavHidden(true);
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    router.prefetch("/wall");
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  // lights come back up, then the editor is back
  const cancel = useCallback(() => {
    setLeaving((was) => {
      if (!was) timer.current = setTimeout(onCancel, FADE_MS);
      return true;
    });
  }, [onCancel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  const torn = () => {
    upsertStub({ ...stub, torn: true });
    router.push(`/wall?pinned=${encodeURIComponent(stub.id)}`);
  };

  return (
    <div className={`ts-stage desk-surface ${styles.stage} ${leaving ? styles.leaving : ""}`} role="dialog" aria-modal="true" aria-label="Tear off your stub">
      <PathTrack current="tear" stubId={stub.id} className={styles.track} />
      <div className={styles.area}>
        <TearGesture stub={stub} onTorn={torn} />
      </div>
      <PaperButton type="button" onClick={cancel}>
        Back to styling
      </PaperButton>
    </div>
  );
}

/**
 * Opening "On your wall" on a stub that is already torn goes to the wall with the stub lifted.
 * The old sheet over a dimmed editor is gone; the wall is where the next steps live.
 */
export function FinishSheet({ stub, open, onClose }: { stub: Stub; open: boolean; onClose: () => void }) {
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    onClose();
    router.push(`/wall?lift=${encodeURIComponent(stub.id)}`);
  }, [open, onClose, router, stub.id]);
  return null;
}
