"use client";
import Link from "next/link";
import type { Stub } from "../types";
import { play, haptic } from "@/customer/studio/feedback";
import { altLabel, setFactValue, toggleKept } from "./ops";
import { Sheet } from "./Sheet";
import styles from "./overlays.module.css";

interface Props {
  stub: Stub;
  factId: string | null;
  onChange: (s: Stub) => void;
  onClose: () => void;
}

/** Fix a fact: the top guesses as chips. No text field. */
export function ChipPopover({ stub, factId, onChange, onClose }: Props) {
  const fact = factId ? stub.event.facts.find((f) => f.id === factId) : undefined;
  const isDate = fact?.id === "date" || /^\d{4}-\d{2}-\d{2}$/.test(fact?.value ?? "");
  const question = isDate ? "Which date was it?" : "Which value was it?";
  const alternatives = fact?.alternatives ?? [];
  const unsure = (fact?.confidence ?? 1) < 0.8;

  return (
    <Sheet title={fact ? (alternatives.length ? question : fact.label) : "Fact"} open={!!fact} onClose={onClose}>
      {fact && (
        <div className={styles.stack}>
          <p className={styles.muted}>
            {unsure ? "We're not sure about this one. Tap the right one." : `From ${fact.source}.`}{" "}
            <span className="provenance">{fact.provenance === "simulated" ? "Sample data" : fact.provenance}</span>
          </p>
          {alternatives.length > 0 && (
            <div className={styles.chipRow} role="group" aria-label={question}>
              {alternatives.map((alt) => (
                <button
                  key={alt}
                  type="button"
                  className={`chip ${styles.bigChip}`}
                  aria-pressed={fact.value === alt && fact.confidence >= 1}
                  onClick={() => {
                    onChange(setFactValue(stub, fact.id, alt));
                    play("stamp");
                    haptic([12]);
                    onClose();
                  }}
                >
                  {altLabel(alt)}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            aria-pressed={!!fact.kept}
            onClick={() => {
              onChange(toggleKept(stub, fact.id));
              play("tick");
            }}
          >
            {fact.kept ? "On the stub · Take it off" : "Keep on stub"}
          </button>
          <Link className={styles.textLink} href="/search">
            None of these · search
          </Link>
        </div>
      )}
    </Sheet>
  );
}
