// Edition metadata. Each edition is the user's artwork, with its own palette and type
// (stub-system); only the foil material and the Ts stamp on the back come from the master brand.
// fontPairs[i] is the title font-family for personal.titleFont === i. bodyFont is fixed per edition.
// No extra webfonts: Fraunces and Inter Tight come from next/font, everything else is a system stack.
import type { Edition } from "../types";

const DISPLAY = 'var(--font-display), "Fraunces", Georgia, serif';
const UI = 'var(--font-ui), "Inter Tight", "Segoe UI", system-ui, sans-serif';
const MONO = 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, "Courier New", monospace';
const COURIER = '"Courier New", Courier, ui-monospace, monospace';
const CONDENSED = 'Impact, "Haettenschweiler", "Arial Narrow Bold", "Arial Narrow", "Franklin Gothic Medium", sans-serif-condensed, sans-serif';
const NARROW = '"Arial Narrow", "Roboto Condensed", "Helvetica Neue Condensed", "Franklin Gothic Medium", sans-serif';
const OLDSTYLE = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const DIDONE = '"Didot", "Bodoni 72", "Bodoni MT", "Times New Roman", serif';

export interface EditionMeta {
  label: string;
  blurb: string;
  orientation: "portrait" | "landscape";
  fontPairs: [string, string, string, string];
  /** Body / small-type family for this edition. */
  bodyFont: string;
  /** Default title colour when personal.titleColor is empty. */
  titleColor: string;
  /** Paper colour (also used on the back). */
  paper: string;
  /** Main ink colour. */
  ink: string;
  /** Accent ink. */
  accent: string;
  /** Procedural-art palette (no text, ever). */
  artPalette: string[];
}

export const EDITION_META: Record<Edition, EditionMeta> = {
  researched: {
    label: "Researched",
    blurb: "Full art, a foil serif title and the facts we found, on a perforated stamp.",
    orientation: "portrait",
    fontPairs: [DISPLAY, OLDSTYLE, UI, DIDONE],
    bodyFont: UI,
    titleColor: "#17140F",
    paper: "#F4ECDD",
    ink: "#17140F",
    accent: "#B4693E",
    artPalette: ["#14201C", "#26302A", "#E9A14B", "#7CC6D2", "#E4572E", "#3B4A43"],
  },
  letterpress: {
    label: "Letterpress",
    blurb: "Cream cotton stock, burnt orange and brown ink, a red date stamp. Admit one.",
    orientation: "landscape",
    fontPairs: [OLDSTYLE, DISPLAY, NARROW, CONDENSED],
    bodyFont: OLDSTYLE,
    titleColor: "#4A2E1E",
    paper: "#F1E4CB",
    ink: "#4A2E1E",
    accent: "#C4551F",
    artPalette: ["#C4551F", "#4A2E1E", "#E3CFA8", "#8C5A3C", "#D98B4F"],
  },
  risograph: {
    label: "Risograph",
    blurb: "Fluoro pink and teal overprint with a knocked-out condensed title.",
    orientation: "portrait",
    fontPairs: [CONDENSED, NARROW, UI, DISPLAY],
    bodyFont: UI,
    titleColor: "#FF48B0",
    paper: "#F3EFE6",
    ink: "#0E6F78",
    accent: "#FF48B0",
    artPalette: ["#FF48B0", "#00A7B5", "#FFE800", "#FF48B0", "#00A7B5"],
  },
  minimal: {
    label: "Minimal",
    blurb: "Bone white, huge date numerals and one signal-orange block.",
    orientation: "portrait",
    fontPairs: [UI, DISPLAY, MONO, DIDONE],
    bodyFont: UI,
    titleColor: "#1A1916",
    paper: "#EEEAE0",
    ink: "#1A1916",
    accent: "#FF5A1F",
    artPalette: ["#1A1916", "#BDB7A9", "#FF5A1F", "#D9D4C7"],
  },
  classic: {
    label: "Classic",
    blurb: "Thermal box-office ticket: security wave, dot-matrix rows, tear-off stub.",
    orientation: "landscape",
    fontPairs: [MONO, COURIER, NARROW, UI],
    bodyFont: MONO,
    titleColor: "#1C2430",
    paper: "#FAFAF6",
    ink: "#1C2430",
    accent: "#2B4C7E",
    artPalette: ["#7CC6D2", "#2B4C7E", "#DDEFF2", "#1C2430"],
  },
};
