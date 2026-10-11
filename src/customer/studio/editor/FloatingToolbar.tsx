"use client";
import { useState, type SVGProps } from "react";
import type { Stub } from "../types";
import { currentVersion } from "../types";
import { EDITION_META } from "@/customer/studio/stub/editions";
import { haptic, play } from "@/customer/studio/feedback";
import { Tool, Tools } from "@/customer/desk/Desk";
import { RemixIcon } from "@/customer/desk/icons";
import { canHide, fontName, hideSelection, setFont, setTitleColour, swatchLabel, TITLE_SWATCHES, toggleFoil, type Selectable } from "./ops";
import styles from "./overlays.module.css";

interface Props {
  stub: Stub;
  selected: Selectable;
  onChange: (s: Stub) => void;
  onDone: () => void;
  onRemix: () => void;
  /** Desktop: frames the selected field on the cutting mat. */
  onZoom?: () => void;
}

const icon: SVGProps<SVGSVGElement> = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

function FontIcon() {
  return (
    <svg {...icon}>
      <path d="M4 18 9 6l5 12M5.8 14h6.4" />
      <path d="M15.5 18v-5.2a2.3 2.3 0 0 1 4.5 0V18M15.5 16.2h4.5" />
    </svg>
  );
}
function ColourIcon({ colour }: { colour: string }) {
  return (
    <svg {...icon}>
      <circle cx="12" cy="12" r="7.5" fill={colour || "var(--ts-foil)"} />
    </svg>
  );
}
function FoilIcon() {
  return (
    <svg {...icon}>
      <path d="m12 3.5 1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9Z" />
      <path d="M18.5 16.5v3M17 18h3" />
    </svg>
  );
}
function HideIcon() {
  return (
    <svg {...icon}>
      <path d="M3.5 12s3.2-5.5 8.5-5.5S20.5 12 20.5 12s-3.2 5.5-8.5 5.5S3.5 12 3.5 12Z" />
      <path d="m5 19 14-14" />
    </svg>
  );
}
function ZoomIcon() {
  return (
    <svg {...icon}>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m14.6 14.6 5 5M8.2 10.5h4.6M10.5 8.2v4.6" />
    </svg>
  );
}
function DoneIcon() {
  return (
    <svg {...icon}>
      <path d="m5.5 12.5 4.2 4.2 8.8-9.4" />
    </svg>
  );
}

type Picker = null | "font" | "colour";

/** Quick, one-tap edits for the selected element. Font and Colour open a small picker. Deeper options live in the inspector. */
export function FloatingToolbar({ stub, selected, onChange, onDone, onRemix, onZoom }: Props) {
  const meta = EDITION_META[currentVersion(stub).edition];
  const [picker, setPicker] = useState<Picker>(null);
  const textual = selected === "title" || selected === "subtitle";
  const name = selected === "facts" ? "Fact line" : selected === "art" ? "Art" : selected === "title" ? "Title" : "Subtitle";
  const fonts = (meta?.fontPairs ?? []).map((stack, i) => ({ i: i as 0 | 1 | 2 | 3, stack, name: fontName(stack, `Font ${i + 1}`) }));

  const edit = (s: Stub) => {
    onChange(s);
  };
  const toggle = (p: Exclude<Picker, null>) => {
    setPicker(picker === p ? null : p);
  };

  return (
    <div className={styles.toolbar} data-picker={picker ?? undefined}>
      {picker === "font" && (
        <div className={styles.picker} role="radiogroup" aria-label="Font">
          {fonts.map((f) => (
            <button
              key={f.i}
              type="button"
              role="radio"
              aria-checked={stub.personal.titleFont === f.i}
              className={styles.pickItem}
              onClick={() => {
                if (stub.personal.titleFont === f.i) return;
                play("select", { direction: f.i > stub.personal.titleFont ? "forward" : "back" });
                haptic(6);
                edit(setFont(stub, f.i));
              }}
            >
              <span className={styles.pickSample} style={{ fontFamily: f.stack }} aria-hidden="true">
                Aa
              </span>
              <span className={styles.pickName}>{f.name}</span>
            </button>
          ))}
        </div>
      )}
      {picker === "colour" && (
        <div className={styles.picker} role="radiogroup" aria-label="Colour">
          {TITLE_SWATCHES.map((sw) => (
            <button
              key={sw.label}
              type="button"
              role="radio"
              aria-checked={stub.personal.titleColor === sw.value}
              className={styles.pickItem}
              onClick={() => {
                if (stub.personal.titleColor === sw.value) return;
                play("select");
                haptic(6);
                edit(setTitleColour(stub, sw.value));
              }}
            >
              <span className={styles.pickDot} style={{ background: sw.value || "var(--ts-foil)" }} aria-hidden="true" />
              <span className={styles.pickName}>{sw.label}</span>
            </button>
          ))}
        </div>
      )}
      <Tools label={`${name} tools`}>
        {textual && (
          <>
            <Tool icon={<FontIcon />} active={picker === "font"} onClick={() => toggle("font")}>
              Font
            </Tool>
            <Tool icon={<ColourIcon colour={stub.personal.titleColor} />} active={picker === "colour"} onClick={() => toggle("colour")} title={`Colour: ${swatchLabel(stub.personal.titleColor)}`}>
              Colour
            </Tool>
            <Tool icon={<FoilIcon />} active={stub.personal.foilTitle} onClick={() => edit(toggleFoil(stub))}>
              Foil
            </Tool>
          </>
        )}
        {selected === "art" && (
          <Tool icon={<RemixIcon />} onClick={onRemix}>
            Remix
          </Tool>
        )}
        {canHide(selected) && (
          <Tool
            icon={<HideIcon />}
            onClick={() => {
              edit(hideSelection(stub, selected));
              onDone();
            }}
          >
            Hide
          </Tool>
        )}
        {onZoom && (
          <Tool icon={<ZoomIcon />} onClick={onZoom} title="Zoom to it (Z)">
            Zoom to it
          </Tool>
        )}
        <Tool icon={<DoneIcon />} onClick={onDone}>
          Back to stub
        </Tool>
      </Tools>
    </div>
  );
}
