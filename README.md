# TicketStub brand kit

The master brand for TicketStub, the keepsake studio that turns any ticket into a stub worth framing.

> **For people who want to keep the night, TicketStub is the keepsake studio that turns any ticket into a stub worth framing. No forms: drop your ticket and it's done.**

Open **[`index.html`](index.html)** for the visual brand board. **[`SPEC.md`](SPEC.md)** is the compact text spec.

## What's here

| Path | Contents |
|---|---|
| `index.html` | Brand board: direction, logo system, colour, type, mockups, imagery, voice, motion, don'ts |
| `SPEC.md` | Positioning, attributes, colour table with contrast, fonts and licence, logo rationale, don'ts |
| `logo/` | Outlined SVGs: stamp (full colour, mono, currentColor), favicon, app icon, wordmarks, lockups |
| `tokens/` | `tokens.json` (DTCG, source of truth), `tokens.css` (CSS variables plus the night theme), `tailwind.preset.js` |
| `docs/` | `logo.md`, `voice.md`, `imagery.md`, `motion-sound-haptics.md`, `material-foil.md` |
| `fonts/` | Fraunces and Inter Tight variable TTFs with their OFL licences |
| `references/` | Curated reference images (WebP) |
| `tools/build_logos.py` | Regenerates every logo SVG from the font outlines |

## Using the tokens

```css
@import "brand-kit/tokens/tokens.css";
.button { background: var(--ts-cta-bg); color: var(--ts-cta-label); border-radius: var(--ts-radius-control); }
.printing-screen { /* switch a subtree to the night stage */ }
```
```html
<section class="ts-night">…</section>
```

## Rebuilding the logos

```sh
python -m pip install fonttools uharfbuzz
python tools/build_logos.py
```

## Scope: two tiers

This kit covers the **master brand** (app UI, logo, marketing, packaging). The stub **editions** (Classic, Letterpress, Risograph, Minimal, Researched) are the user's artwork and have their own palettes, defined in [ticket-studio](https://github.com/Jevelopers-neatHack-2026/ticket-studio) under `docs/stub-system.md`.

Built with the brandkit skill workflow. Skill curated by Collective Brain (collectivebrain.de) and WhiteFox Automations (whitefox-automations.com).

## Architecture and delivery

- [Repository responsibilities and interfaces](docs/architecture/OWNERSHIP.md)
- [Relevant acceptance criteria](docs/architecture/ACCEPTANCE.md)
- [Architecture and diagrams](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md)
- [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md)

Architecture integration documents the intended boundaries. It does not establish completed product functionality, passing implementation tests, connected sponsor tools, or live financial activity.
