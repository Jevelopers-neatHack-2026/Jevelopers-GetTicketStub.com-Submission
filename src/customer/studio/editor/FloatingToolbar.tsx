"use client";
import type { Stub } from "../types";
import { currentVersion } from "../types";
import { EDITION_META } from "@/customer/studio/stub/editions";
import { play } from "@/customer/studio/feedback";
import { canHide, cycleColour, cycleFont, fontName, hideSelection, swatchLabel, toggleFoil, type Selectable } from "./ops";
import styles from "./overlays.module.css";

interface Props {
  stub: Stub;
  selected: Selectable;
  onChange: (s: Stub) => void;
  onDone: () => void;
  onRemix: () => void;
}

/** Quick, one-tap edits for the selected element. Deeper options live in the inspector or sheets. */
export function FloatingToolbar({ stub, selected, onChange, onDone, onRemix }: Props) {
  const meta = EDITION_META[currentVersion(stub).edition];
  const font = fontName(meta?.fontPairs?.[stub.personal.titleFont], `Font ${stub.personal.titleFont + 1}`);
  const name = selected === "facts" ? "Fact line" : selected === "art" ? "Art" : selected === "title" ? "Title" : "Subtitle";

  const edit = (s: Stub) => {
    play("tick");
    onChange(s);
  };

  return (
    <div className={styles.toolbar} role="toolbar" aria-label={`${name} tools`}>
      <span className={styles.toolbarName}>{name}</span>
      {(selected === "title" || selected === "subtitle") && (
        <>
          <button type="button" className={styles.toolBtn} onClick={() => edit(cycleFont(stub))} title={`Font: ${font}`}>
            <span aria-hidden="true" className={styles.toolGlyph}>Aa</span>
            <span>Font</span>
            <span className="visually-hidden">, now {font}</span>
          </button>
          <button type="button" className={styles.toolBtn} onClick={() => edit(cycleColour(stub))} title={`Colour: ${swatchLabel(stub.personal.titleColor)}`}>
            <span aria-hidden="true" className={styles.swatch} style={{ background: stub.personal.titleColor || "var(--ts-foil)" }} />
            <span>Colour</span>
            <span className="visually-hidden">, now {swatchLabel(stub.personal.titleColor)}</span>
          </button>
          <button type="button" className={styles.toolBtn} aria-pressed={stub.personal.foilTitle} onClick={() => edit(toggleFoil(stub))}>
            <span aria-hidden="true" className={`${styles.swatch} ${styles.foilSwatch}`} />
            <span>Foil</span>
          </button>
        </>
      )}
      {selected === "art" && (
        <button type="button" className={styles.toolBtn} onClick={onRemix}>
          <span aria-hidden="true" className={styles.toolGlyph}>✦</span>
          <span>Remix the art</span>
        </button>
      )}
      {canHide(selected) && (
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => {
            edit(hideSelection(stub, selected));
            onDone();
          }}
        >
          <span aria-hidden="true" className={styles.toolGlyph}>⊘</span>
          <span>Hide</span>
        </button>
      )}
      <button type="button" className={styles.toolBtn} onClick={onDone}>
        <span>Done</span>
      </button>
    </div>
  );
}
