"use client";
import type { Edition, Stub } from "../types";
import { EDITIONS, currentVersion } from "../types";
import { StubView } from "@/customer/studio/stub/StubView";
import { EDITION_META } from "@/customer/studio/stub/editions";
import { previewEdition } from "./ops";
import { Sheet } from "./Sheet";
import styles from "./overlays.module.css";

interface GridProps {
  stub: Stub;
  onPick: (e: Edition) => void;
  compact?: boolean;
}

/** All five editions with the same data and art. Used in the sheet (phone) and the left rail (desktop). */
export function StyleGridItems({ stub, onPick, compact }: GridProps) {
  const active = currentVersion(stub).edition;
  return (
    <div className={compact ? styles.styleGridCompact : styles.styleGrid} role="group" aria-label="Styles">
      {EDITIONS.map((ed) => {
        const meta = EDITION_META[ed];
        return (
          <button
            key={ed}
            type="button"
            className={styles.styleCell}
            aria-pressed={ed === active}
            onClick={() => onPick(ed)}
          >
            <span className={styles.styleThumb} aria-hidden="true">
              <StubView stub={previewEdition(stub, ed)} size="sm" />
            </span>
            <span className={styles.styleName}>{meta?.label ?? ed}</span>
            {!compact && meta?.blurb && <span className={styles.styleBlurb}>{meta.blurb}</span>}
          </button>
        );
      })}
    </div>
  );
}

interface SheetProps extends GridProps {
  open: boolean;
  onClose: () => void;
}

export function StyleGrid({ open, onClose, stub, onPick }: SheetProps) {
  return (
    <Sheet title="All styles" open={open} onClose={onClose} wide>
      <StyleGridItems stub={stub} onPick={onPick} />
      <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}
