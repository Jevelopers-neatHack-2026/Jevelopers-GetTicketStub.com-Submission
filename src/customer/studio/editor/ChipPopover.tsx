"use client";
import Link from "next/link";
import type { Stub } from "../types";
import { LeavesMark } from "@/customer/pages/ui";
import { play, haptic } from "@/customer/studio/feedback";
import { PaperSheet, SourceMark, Tag, Tags } from "@/customer/desk/Desk";
import { altLabel, setFactValue, toggleKept } from "./ops";
import styles from "./overlays.module.css";

interface Props {
  stub: Stub;
  factId: string | null;
  onChange: (s: Stub) => void;
  onClose: () => void;
}

/** Fix a fact: the top guesses as paper tags. No text field. */
export function ChipPopover({ stub, factId, onChange, onClose }: Props) {
  const fact = factId ? stub.event.facts.find((f) => f.id === factId) : undefined;
  const isDate = fact?.id === "date" || /^\d{4}-\d{2}-\d{2}$/.test(fact?.value ?? "");
  const question = isDate ? "Which date was it?" : "Which value was it?";
  const alternatives = fact?.alternatives ?? [];
  const unsure = (fact?.confidence ?? 1) < 0.8;

  return (
    <PaperSheet title={fact ? (alternatives.length ? question : fact.label) : "Fact"} open={!!fact} onClose={onClose}>
      {fact && (
        <div className={styles.stack}>
          <p className={styles.muted}>
            {unsure ? "We're not sure about this one. Tap the right one." : `From ${fact.source}.`}
            <SourceMark p={fact.provenance} />
          </p>
          {alternatives.length > 0 && (
            <Tags label={question}>
              {alternatives.map((alt) => (
                <Tag
                  key={alt}
                  pressed={fact.value === alt && fact.confidence >= 1}
                  onClick={() => {
                    onChange(setFactValue(stub, fact.id, alt));
                    play("stamp");
                    haptic([12]);
                    onClose();
                  }}
                >
                  {altLabel(alt)}
                </Tag>
              ))}
            </Tags>
          )}
          <Tags>
            <Tag
              pressed={!!fact.kept}
              onClick={() => {
                onChange(toggleKept(stub, fact.id));
              }}
            >
              {fact.kept ? "On the stub" : "Keep on stub"}
            </Tag>
          </Tags>
          <Link className={styles.textLink} href="/search">
            None of these? Search for your show
            <LeavesMark />
          </Link>
        </div>
      )}
    </PaperSheet>
  );
}
