# Foil and holo material

The technique is adapted from lmvdz/coven-cave (`feat/cave-3rz-conjure-flow`, `src/lib/foil/*`, `src/styles/familiar-card.css`). The full engineering notes live in [getticketstub.com `docs/studio/research/holo-foil-technique.md`](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/43bb721f00de1c616e8e8d27efbb87c6bf75bcbf/docs/studio/research/holo-foil-technique.md).

## Principle: the pattern stays fixed, the colour moves

Real stamped foil has a fixed shape and a colour that shifts as you move it. We render it the same way:

1. **Plate:** a greyscale PNG computed once per stub and seeded from the stub's ID, so the preview matches the print. White means foil; black means paper.
2. **Colour:** a gradient multiplied into the plate (`background-blend-mode: multiply`). Only the gradient moves with the light.
3. **Foil layer:** placed over the stub with `mix-blend-mode: screen`.
4. **Glare:** a white radial gradient at the light position, with `mix-blend-mode: overlay`.
5. **Glow:** opacity is `0.42 + 0.52 × glow`, where glow is 0 at rest and 1 while the stub is tilted.

## Finishes

| Finish | Plate | Colour |
|---|---|---|
| **Brand foil** (Ts stamp, foil titles) | Text or logo raster, white on black | `--ts-foil` (copper → orange → cyan) |
| **Gold / copper foil** (Letterpress, Researched editions) | Text raster | Copper-weighted foil |
| **Spot holo** (lamplight, windows in art) | Highlight mask taken from the art (about 6% coverage) | `--ts-holo-spectrum` |
| **Holographic stock** (print upgrade) | Full-bleed halftone, no mask | `--ts-holo-spectrum` |
| **Emboss / deboss** | Height map from the text raster | Light and shadow driven by the same light position (new; not in coven-cave) |

The full rainbow appears only on holographic stock and spot holo. Everything branded uses the brand foil.

## Rules: foil must never pop

The first board shipped with a foil effect that snapped on when the pointer entered and was far too strong. These rules exist because of that. All of them are required.

### Smoothness

1. **Never drive a visual from a stepped value.** Setting `--glow` from 0 to 1 in an event handler makes the sheen appear in one frame, because CSS can't transition an unregistered custom property. Ease every input (light position, tilt and glow) toward its target in a `requestAnimationFrame` loop, with time-based exponential smoothing:
   `current += (target - current) * (1 - exp(-dt / tau))`
2. **Keep one motion model.** Don't toggle CSS `transition` durations on enter and leave (for example 380 ms at rest and 80 ms while tracking). The switch itself causes a snap on the first move. Choose either rAF smoothing or a registered `@property` with a transition, and use it for every value.
3. **Start from where it is.** On pointer enter, ease from the current values, never from the resting ones. On leave, ease back to rest.
4. **Glow fades in slower than it tracks.** `tau`: tilt 110 ms, light position 90 ms, glow in 400 ms, glow out 600 ms.
5. **There's no "off" state.** At rest the foil keeps a faint sheen (`glow` 0.1), so it never appears out of nothing.
6. **Clamp dt to 50 ms** so a dropped frame or a returning tab can't jump.

### Intensity

| Layer | Blend | Max opacity at glow 1 |
|---|---|---|
| Brand foil sheen (copper/cyan band, about 40% of the gradient length, travels 90% across) | `overlay` | 0.5 |
| Glare (white radial) | `overlay` | 0.3 at the centre |
| Rainbow spectrum (holo stock only) | `screen`, multiplied into a plate | 0.94 (coven-cave's 0.42 + 0.52) |

- **Never use `color-dodge`** or full-coverage rainbow on the brand mark. Dodge blows out the orange.
- **Tilt is at most ±11°.**

### Acceptance check

Before you ship a foil change:
- At 60 Hz, sheen opacity may change by **at most 0.02 per frame** while entering, moving or leaving. Today's values give 0.018 at 60 Hz.
- Watch it at real speed on a dark and on a light background. If you notice the foil before you notice the stamp, it's too strong. If you have to hunt for it while moving the pointer, it's too weak.

**Calibration history:** sheen 0.32 with `soft-light` and glare 0.18 was too subtle, because `soft-light` barely changes orange. Sheen 0.5 with `overlay` and glare 0.3 is the current setting. When you raise the caps, slow `tauGlowIn` to keep the 0.02 per-frame limit; the per-frame step scales with cap × (1 − e^(−16.7/τ)).

Tokens: `material.foil` in `tokens/tokens.json`.
