# Foil and holo material

The technique is adapted from lmvdz/coven-cave (`feat/cave-3rz-conjure-flow`, `src/lib/foil/*`, `src/styles/familiar-card.css`). The full engineering notes live in `ticket-studio/research/holo-foil-technique.md`.

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
