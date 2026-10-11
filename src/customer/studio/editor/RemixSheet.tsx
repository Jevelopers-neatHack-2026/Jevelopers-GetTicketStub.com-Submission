"use client";
import { useRef, useState } from "react";
import type { Stub } from "../types";
import { currentVersion } from "../types";
import { remixArtNoted } from "@/customer/studio/research/client";
import { play, haptic } from "@/customer/studio/feedback";
import { PaperButton, PaperSheet, Tag, Tags, TearLink } from "@/customer/desk/Desk";
import { addArtVersion, readImageFile } from "./ops";
import styles from "./overlays.module.css";

export const VIBES = ["Neon", "Risograph", "70s", "Minimal"] as const;

interface PanelProps {
  stub: Stub;
  onChange: (s: Stub) => void;
  /** Opens the agent for a free-text description. */
  onDescribe: () => void;
  onDone?: () => void;
}

/** Art from the stub's earlier remixes, so a remix can always be undone. One entry per look. */
function earlierArt(stub: Stub) {
  const cur = currentVersion(stub);
  const seen = new Set<string>([`${cur.art.kind}:${cur.art.src ?? ""}:${cur.art.seed}`]);
  return stub.versions
    .map((v) => v.art)
    .filter((a) => {
      const key = `${a.kind}:${a.src ?? ""}:${a.seed}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Vibe tags, a photo option and one action. Free text lives behind "Describe it instead". */
export function RemixPanel({ stub, onChange, onDescribe, onDone }: PanelProps) {
  const [vibe, setVibe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const earlier = earlierArt(stub);

  const finish = (s: Stub) => {
    onChange(s);
    play("success");
    haptic([18, 40, 28]);
    onDone?.();
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    play("remix");
    try {
      const { art, limitNote } = await remixArtNoted(stub, vibe ?? undefined);
      if (limitNote) {
        // Procedural art is applied, and the sheet stays open so the note is read.
        onChange(addArtVersion(stub, art));
        play("success", { emphasis: "subtle" });
        setError(limitNote);
      } else {
        finish(addArtVersion(stub, art));
      }
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
      <span className="desk-label">Pick a look</span>
      <Tags label="Vibe">
        {VIBES.map((v) => (
          <Tag key={v} pressed={vibe === v} disabled={busy} onClick={() => setVibe(vibe === v ? null : v)}>
            {v}
          </Tag>
        ))}
        <Tag disabled={busy} onClick={() => fileRef.current?.click()}>
          From my photo
        </Tag>
      </Tags>
      <input
        ref={fileRef}
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Choose a photo for the art"
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => onPhoto(e.target.files?.[0])}
      />
      <TearLink onClick={onDescribe}>Describe it instead</TearLink>
      <PaperButton block onClick={run} disabled={busy}>
        {busy ? "Remixing…" : "Remix the art"}
      </PaperButton>
      <p className={styles.muted} role="status" aria-live="polite">
        {busy ? "Remixing. Your text and edits stay." : (error ?? "Your text and edits stay. Each remix is kept, so you can go back.")}
      </p>
      {earlier.length > 0 && (
        <>
          <span className="desk-label">Go back to</span>
          <Tags label="Earlier art">
            {earlier.map((a, i) => (
              <Tag
                key={`${a.kind}-${a.seed}-${i}`}
                disabled={busy}
                onClick={() => {
                  onChange(addArtVersion(stub, a));
                  onDone?.();
                }}
              >
                {a.vibe === "photo" ? "Your photo" : a.vibe ? a.vibe : "First art"}
              </Tag>
            ))}
          </Tags>
        </>
      )}
    </div>
  );
}

interface SheetProps extends Omit<PanelProps, "onDone"> {
  open: boolean;
  onClose: () => void;
}

export function RemixSheet({ open, onClose, ...rest }: SheetProps) {
  return (
    <PaperSheet title="Remix the art" open={open} onClose={onClose}>
      <RemixPanel {...rest} onDone={onClose} />
    </PaperSheet>
  );
}
