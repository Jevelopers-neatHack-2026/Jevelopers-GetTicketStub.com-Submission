# TicketStub brand spec

The compact reference. The visual version is [`index.html`](index.html) (the brand board).

## Positioning

> **For people who want to keep the night, TicketStub is the keepsake studio that turns any ticket into a stub worth framing. No forms: drop your ticket and it's done.**

Organizer line: *Upload your guest list. Every guest gets their own stub.*

Every design decision below has to serve that sentence. "Keep the night" asks for a physical object, "worth framing" asks for premium craft, and "no forms" asks for direct, playful interaction.

## Attributes

| Attribute | What it means in practice |
|---|---|
| **Tactile** | Paper grain, perforations, raking light, things you tear, flip and pin. The app should feel like handling an object rather than filling out a page. |
| **Premium** | Foil and holo, collector-grade printing, restraint in the UI so the stub is the richest thing on screen. It should look worth $89 framed. |
| **Playful** | Shuffle, remix, tear-off, sound and haptics. The interactions should surprise you, while the copy stays plain. |

## Design directions

| Direction | Look | Verdict |
|---|---|---|
| A. Paper Desk | Cream stock, warm window light, letterpress serif | The base. It reads as tactile and as a keepsake. |
| B. Night Stage | Ink and moss, copper-to-cyan foil light leaks | Used for moments: printing, reveal, finishes, tear. It reads as premium. |
| C. Box Office | Thermal mono, Swiss grid, security wave | Rejected as the master brand, because it feels transactional (it's what a ticketing vendor looks like). It survives as the Classic stub edition. |

**Recommended: A + B, "paper by day, foil by night".** The everyday studio is paper, so it feels like handling a real stub. The moments that sell the product switch to the dark stage, because foil only glows against dark.

## Two tiers

1. **Master brand** (this repo): the app UI, logo, marketing, packaging. Six colours, two typefaces, fixed.
2. **Stub editions** ([getticketstub.com `docs/studio/stub-system.md`](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/43bb721f00de1c616e8e8d27efbb87c6bf75bcbf/docs/studio/stub-system.md)): Classic, Letterpress, Risograph, Minimal and Researched. Each has its own palette and type, because the stub is the user's artwork, not our chrome. The only parts of the master brand that appear on an edition are the "Ts" stamp on the back and the foil material.

## Colour

| Token | HEX | Job | Contrast |
|---|---|---|---|
| Ticket Orange | `#E4572E` | Primary. CTAs, the stamp, the one orange accent in generated art | Ink label on orange 5.0:1. On cream: large text only (3.1:1) |
| Copper | `#B4693E` | Secondary. Foil gradient start, premium tiers (print, frame) | Large text only on cream (3.6:1) |
| Stage Moss | `#26302A` | Secondary dark. Raised surfaces at night (sheets, panels, printing screen) | Cream on moss 11.6:1 |
| Holo Cyan | `#7CC6D2` | Accent. Foil gradient end, focus and selection on dark | 9.5:1 on ink. Never text on cream |
| Stub Cream | `#F4ECDD` | Neutral light. Paper, day background | |
| Night Ink | `#17140F` | Neutral dark. Body text, night background | 15.6:1 on cream |

- **Muted text** is ink or cream at 66% opacity: 5.6:1 on cream, 7.3:1 on ink. It is not a seventh colour.
- **Foil** is `linear-gradient(135deg, copper 0%, orange 45%, cyan 100%)`.

## Typography

| Role | Family | Settings | License |
|---|---|---|---|
| Display / logo | **Fraunces** (variable) | Logo: opsz 144, wght 600, SOFT 0, WONK 0. Headlines: wght 560, SOFT 30, tracking -0.02em | SIL OFL 1.1 |
| UI / body / ticket data | **Inter Tight** (variable) | 400 body, 500 labels, 600 buttons; `tabular-nums` for dates, seats and prices | SIL OFL 1.1 |

- **Fallbacks:** `Iowan Old Style, Palatino Linotype, Georgia, serif` and `Segoe UI, system-ui, -apple-system, sans-serif`.
- **Scale** is a major third (×1.25) from 16 px: 12.8 / 16 / 20 / 25 / 31.25 / 39 / 48.8 / 61.
- **Why:** Fraunces carries the bracketed, slightly soft serifs of the stamped "Ts" and has a playful WONK axis for later. Inter Tight is compact enough for dense ticket data on a phone.

## Logo

| Asset | Use | Rationale |
|---|---|---|
| `ts-stamp.svg` | Primary symbol: app, social, stub back | A postage stamp says "kept, sent, collected". The perforated edge is the same edge the user tears in the app. |
| `ts-stamp-mono-*.svg`, `ts-stamp-currentcolor.svg` | One colour, letters knocked out | Works on any background and on foil or emboss print without a second ink. |
| `favicon.svg` | 16–32 px | A square stamp with 4 bites per side and heavier letters, so it stays legible at 16 px. |
| `wordmark.svg` | Ticket┊Stub | The dotted tear line between the words is the product's signature moment set in type. |
| `wordmark-compact.svg` | Under 120 px wide | The dots disappear at small sizes, so this version drops them. |
| `lockup-horizontal*.svg`, `lockup-stacked.svg` | Headers, packaging | The stamp is 1.9× cap height (horizontal) or 2.6× (stacked). |
| `app-icon.svg` | iOS and Android, 1024 px | A foil stamp on Night Ink, which reads on both light and dark home screens. |

Usage rules are in [`docs/logo.md`](docs/logo.md).

## Don'ts

1. **Don't set body text in orange, copper or cyan on cream.** They fail 4.5:1. Use ink, and keep the colours for large type and fills.
2. **Don't put the stamp straight onto busy art.** Use the mono version on a cream or ink plate, or the full-colour version on a flat field.
3. **Don't redraw, rotate, outline or re-gradient the stamp.** The foil gradient is always copper → orange → cyan at 135°.

## More

- Voice: [`docs/voice.md`](docs/voice.md)
- Imagery and AI art rules: [`docs/imagery.md`](docs/imagery.md)
- Motion, sound and haptics: [`docs/motion-sound-haptics.md`](docs/motion-sound-haptics.md)
- Foil and holo material: [`docs/material-foil.md`](docs/material-foil.md)
