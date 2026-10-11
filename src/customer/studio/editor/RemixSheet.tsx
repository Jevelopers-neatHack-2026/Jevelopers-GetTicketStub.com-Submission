"use client";
import { useId, useRef, useState } from "react";
import type { Stub } from "../types";
import { remixArt } from "@/customer/studio/research/client";
import { play, haptic } from "@/customer/studio/feedback";
import { addArtVersion, readImageFile } from "./ops";
import { Sheet } from "./Sheet";
import styles from "./overlays.module.css";

export const VIBES = ["Neon", "Risograph", "70s", "Minimal"] as const;

interface PanelProps {
  stub: Stub;
  onChange: (s: Stub) => void;
  /** Opens the agent for a free-text description. */
  onDescribe: () => void;
  onDone?: () => void;
  compact?: boolean;
}

/** Vibe chips, a photo option and one CTA. Free text lives behind "Describe it instead". */
export function RemixPanel({ stub, onChange, onDescribe, onDone, compact }: PanelProps) {
  const [vibe, setVibe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const idBase = useId();

  const finish = (s: Stub) => {
    onChange(s);
    play("done");
    haptic([18, 40, 28]);
    onDone?.();
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    play("print");
    try {
      const art = await remixArt(stub, vibe ?? undefined);
      finish(addArtVersion(stub, art));
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't remix the art. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const src = await readImageFile(file);
      finish(addArtVersion(stub, { kind: "image", src, seed: Date.now() % 100000, vibe: "photo", provenance: "live" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't read that photo. Try another one.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className={styles.stack} aria-busy={busy}>
      {compact && <p className="label">Remix the art</p>}
      <div className={styles.chipRow} role="group" aria-label="Vibe">
        {VIBES.map((v) => (
          <button key={v} type="button" className="chip" aria-pressed={vibe === v} onClick={() => setVibe(vibe === v ? null : v)} disabled={busy}>
            {v}
          </button>
        ))}
        <button type="button" className="chip" disabled={busy} onClick={() => fileRef.current?.click()}>
          From my photo
        </button>
        <input
          ref={fileRef}
          id={`${idBase}-photo`}
          className="visually-hidden"
          tabIndex={-1}
          aria-label="Choose a photo for the art"
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => onPhoto(e.target.files?.[0])}
        />
      </div>
      <button type="button" className={styles.textLinkBtn} onClick={onDescribe}>
        Describe it instead ›
      </button>
      <button type="button" className={`btn btn-primary ${compact ? "" : "btn-block"}`} onClick={run} disabled={busy}>
        {busy ? "Remixing…" : "Remix the art"}
      </button>
      <p className={styles.muted} role="status" aria-live="polite">
        {busy ? "Remixing… keeps your text and edits" : error ?? "Keeps your text and edits. Each remix is saved as a new style."}
      </p>
    </div>
  );
}

interface SheetProps extends Omit<PanelProps, "onDone" | "compact"> {
  open: boolean;
  onClose: () => void;
}

export function RemixSheet({ open, onClose, ...rest }: SheetProps) {
  return (
    <Sheet title="Remix the art" open={open} onClose={onClose}>
      <RemixPanel {...rest} onDone={onClose} />
    </Sheet>
  );
}
