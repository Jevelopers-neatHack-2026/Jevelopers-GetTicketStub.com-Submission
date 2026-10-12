# getticketstub.com: handoff for a new Claude chat

Paste this file into a new chat (or keep it as CLAUDE.md), then say what you want next.

## 0. First things in the new chat

1. **Use the skills installed since the last chat.** The **hairline** skill, **Emil's** animation skill and **Motion's** skill were installed after the last session started, so it never saw them. Load them first.
   - **Hairline:** use it to make hairline options for this site, then apply the owner's pick.
   - **Emil and Motion:** use them to review and refine the animation already built (section 5).
2. **Load the live page:** run Artifact `read` on the live page (section 2), rebuild the workspace (section 6), make changes, then republish to the **same URL**.

**Owner preferences:**
- Instructions about lajefahemp.com apply only when that project is named. This is not that project.
- The owner may redirect at any time. If they reject a tool call, stop and wait.
- They like to see options on the design canvas first, then have the pick applied to the live site.

## 1. What this is

getticketstub.com is a cinematic, scroll-driven landing page for TicketStub: commemorative ticket-stub art for games, gigs and shows people went to.

**Original brief (still applies):**
- Be at least as polished as takeboost.com, without copying it.
- Each event gets its own scene, with a performer throwing the stub.
- Use a Blender stub asset and Blender flight animation.
- Stubs fly one by one, then all at once, with paper physics.
- They fill a corkboard until it's full, then the "Make yours!" checkout appears.
- Independent reviewer subagents must score it above 80%. Republish before every review round.

## 2. Links

| What | Where |
|---|---|
| **Live site (artifact)** | https://claude.ai/artifact/LPQUiDHBDcT5wBEuBXNqY3 (version 24) |
| **Design canvas** | https://claude.ai/artifact/7avhFNiqnwxh5cKodZj4Xx (version 8), a Design-type artifact |
| **GitHub org** | Jevelopers-neatHack-2026 (all public) |

**What's on the design canvas:** six palette boards and a hairline board.
- Palette boards: `Main` (old Print Shop palette), `Floodlight`, `Riso`, `Velvet`, `Sorbet` and `Press` (Press Proof, **the chosen palette**).
- `Hairlines.dc.html`: options A–H, made **without** the hairline skill. Redo it with the skill.
- The canvas is shared as "anyone with the link".

**GitHub repos used:**
- `brand-kit`
  - `tokens/tokens.json`: the source of truth for colour, type and motion.
  - `docs/motion-sound-haptics.md` and `docs/material-foil.md`: the motion, sound, haptics and foil rules.
- `getticketstub.com`: the Next.js app, including the studio stub, foil, tear and tilt code under `src/customer/studio/stub/`.
- `print-production`: Zac's print engine. It's where the crop and registration marks, bleed lines, proof labels and zero-padded serials (000123, 0002) come from.

**Published files inside the site artifact:**
- `index.html`: the whole page.
- `assets/ticketstub.gltf.json`: the Blender export.
- `assets/flight.json`: flight data and shape-key weights.
- `assets/qb|pitcher|singer|hoops|hockey.webp`: the performer cut-outs.
- `src/*.txt`: the Blender build script, the GLB-to-JSON converter, the Playwright harness `shoot.py`, `fonts.css` and the review brief.

## 3. Current state (version 24)

### Palette: Press Proof (the TicketStub brand kit)

| Token | Colour | Name |
|---|---|---|
| `--ink` | `#17140f` | ink |
| `--stock` | `#f4ecdd` | cream |
| `--punch` | `#e4572e` | vermilion |
| `--copper` | `#b4693e` | copper |
| `--foil` | `#7cc6d2` | cyan, used as the solid accent |
| `--moss` | `#26302a` | moss |
| `--foilgrad` | `linear-gradient(135deg, #b4693e, #e4572e 45%, #7cc6d2)` | foil gradient |

- **Fonts:** headlines are Fraunces 700, with accent words in italic vermilion or cyan. Body and UI text is Inter Tight. Stub art keeps Archivo wide caps, Big Shoulders numbers and IBM Plex Mono.
- **Where the colours show:**
  - "How it works" sits on cyan.
  - The foil gradient is on the marquee borders and dots, the finale eyebrow, the scroll rail and the footer wordmark.
- **Hero press marks:** crop corners, a registration target near the disc, and a "Proof 000001 · 300 gsm · bleed 3 mm · sRGB" line.

### One stub design everywhere

- **Canvas stubs:** `drawTicket()` draws every canvas and 3D-texture stub in the studio-card style. That means a halftone art panel, outline-over-filled word pairs (GAME/DAY, SOLD/OUT, OVER/TIME, FIRST/PITCH, TIP/OFF), a kind pill, number boxes, a perforation and the TS stamp drawn from `#tsStamp` through Path2D.
- **HTML cards:** the `.ts-stub` cards (the `TS` component) are used in the Studio, the gallery ribbon and the checkout preview.

### One checkout

- **The form:** the only checkout is `#maker` in the corkboard finale. It sends `link` to https://gvk66o79l1.c38.airoapp.ai/. It has a live preview card and the demo chips gulls, nova and wolves.
- **Links:** every "Make yours" button links to `#make`.
- **Studio section:** it's step 2 of the story ("Every detail, read from your ticket."). Three proof cards sit on a print bed with crop marks, and there's a drag-to-tear bar. It has no second corkboard and no second pitch.

### Page order

1. Loader
2. Hero
3. Marquee
4. Statement
5. Scenes intro
6. Five pinned scenes (football, baseball, concert, basketball, hockey)
7. Interlude
8. How it works
9. Studio
10. "Hot off the press" gallery
11. Corkboard: 560vh; the five heroes land one by one, then the swarm, then the finale checkout
12. Footer

## 4. Stack

- **Libraries:** three.js r160 and Lenis 1.1.13 load through an import map from jsdelivr. **Motion 11.11.17** (motion.dev) loads as a UMD script at `https://cdn.jsdelivr.net/npm/motion@11.11.17/dist/motion.js`, which exposes `window.Motion`.
- **Fonts:** loaded from Google Fonts: Archivo, Big Shoulders Display, IBM Plex Mono, Abril Fatface, Fraunces and Inter Tight.
- **Artifact limits:** scripts must come from approved CDNs. The asset files are served as published files, and `.glb` can't be served, which is why the model is a `.gltf.json`.

## 5. Motion that's already built (check it against Emil's and Motion's skills)

All of it lives in the `window.TSMotion` block. Timings come from the brand kit: quick 160ms, base 240ms, settle 380ms, reveal 600ms, shutter 320ms and print-sweep 2600ms. Easings are enter `(.16,1,.3,1)`, standard `(.2,.8,.2,1)`, flip `(.45,0,.55,1)`, and Emil-style out `(.23,1,.32,1)`.

**Hero**
- **Letters:** "You were there." is split into letters, which rise with a blur-out over 0.9s at a 45ms stagger.
- **Swash:** a cyan line draws under "there.".
- **Scroll:** the three lines drift apart via `Motion.scroll` as the hero leaves.
- **3D stub entrance:** it drops onto the disc on a spring, driven by `window.__heroIntro`.
- **Disc flick:** pressing or swiping the disc spins the stub on a spring with drag velocity (`window.__heroSpin`).

**Scroll reveals**
- **Headlines:** they wipe up with a clip-path while the copy staggers in. The code watches the section element, because a clip-path-hidden target never reports as visible to IntersectionObserver.
- **Fallbacks:** a scroll and interval watcher backs this up when someone jumps straight to an anchor, and a settle timeout finishes stuck animations.

**Cards**
- **Tilt:** smoothed with an exponential time constant of 110ms, glow fading in over 400ms and out over 600ms, capped at ±11°.
- **Flip:** 380ms on the flip curve.

**Checkout**
- **Typing:** a foil print-sweep runs while you type, with "Printing proof…" showing.
- **Proof ready:** when it lands, a red/cyan RGB-split shutter flash plays and the phone buzzes `[18,40,28]`.
- **Button:**
  - **Press:** it scales to 0.97.
  - **Hover:** on desktop it leans magnetically toward the cursor with a spring on the CSS `translate` property.
  - **First view:** a foil gleam sweeps across it once when the finale opens.
  - **Empty submit:** the input shakes.
  - **Valid submit:** "Make my stub →" swaps to "Sent to the studio ↗" with a blur crossfade and a spring pop.

**Studio**
- **Drag to tear:** past 60%, the cards flip and pin at a random ±4°, with buzzes `[4]` per tick, `[30,30,60]` on the tear and `[20]` when they pin.

**Reduced motion:** visitors with `prefers-reduced-motion` get static output.

**Gotchas from building this:**
- **Inline transforms erase the card tilt:** Motion's `x`, `y`, `scale` and `rotate` write an inline `transform`, which wipes the cards' CSS `rotate(var(--rot))`. Use the independent CSS `translate` and `scale` properties, or `el.animate()` with `scale`, instead.
- **Animations can stall:** in headless Chromium, Motion's WAAPI animations sometimes start with a future `startTime` and hold `fill:both`. That's why every reveal has a settle that calls `finish()` on its animations and clears the inline styles.

**Not built yet:** sound. The brand kit says to use cuelume.dev sounds, which can't be downloaded from the sandbox, so the owner needs to supply the files.

## 6. Workspace and test harness

The cloud workspace is wiped between chats, so rebuild it.

```
/home/claude/ts/site/index.html, site/assets/*   (pull from the artifact with read + paths)
/home/claude/ts/test/shoot.py, fonts.css, f/*.woff2, node_modules
```

**Setup:**

```
cd /home/claude/ts/test
npm i three@0.160.0 lenis@1.1.13 motion@11.11.17 @fontsource-variable/archivo @fontsource/big-shoulders-display @fontsource/ibm-plex-mono @fontsource/abril-fatface @fontsource-variable/fraunces @fontsource-variable/inter-tight
```

- Copy the `.woff2` files that `fonts.css` names into `f/`.
- In `shoot.py`, add this to `MAP`: `'https://cdn.jsdelivr.net/npm/motion@11.11.17/': f'{TEST}/node_modules/motion/'`.

**Run it:**

```
PORT=8765 VW=1440 VH=900 WAIT=4000 SHOTS='[["hero",0],["s0",[".scene[data-i=\"0\"]",0.35]],["fin",["#wall",0.95]],["foot",99999]]' python3 shoot.py <outdir>
# optional EVAL='<js expression or Promise>' runs before each screenshot
```

**Gotchas:**
- The swarm renders slowly in software WebGL, so use `WAIT` ≥ 4000.
- Check phone layouts at 390×844.
- Delete `site/_w*.html` before publishing.
- Publish with `Artifact publish url=<site URL> file_path=/home/claude/ts/site/index.html`. The other files stay as they are.

## 7. Open items

1. **Hairlines:** run the hairline skill and add its options to the canvas. My A–H board (perforation, crop and register, foil hairline, double rule, dotted leaders, bleed guide, guilloché, off-register outline) is a stand-in, and I suggested A, C and E. Apply the owner's pick to the site.
2. **Motion review:** go over section 5 with Emil's and Motion's skills and tighten durations, curves and springs where they disagree.
3. **Independent review:** the page hasn't been reviewed since v14 (scores 78 and 80). Republish, then run two reviewer subagents with the brief in `src/BRIEF.md.txt` until both score above 80%.
4. **Reviewer asks still open:**
   - A bigger, more sculptural 3D hero stub.
   - Cleaner cut-out edges, especially the singer's hair.
   - Swarm stubs seen edge-on read as dark slivers.
   - Phone corkboard framing.
   - Soccer, festival and theatre scenes (their flights S4–S6 already exist).
5. **Sound:** add cuelume.dev sounds per the brand kit once the owner supplies the files.
