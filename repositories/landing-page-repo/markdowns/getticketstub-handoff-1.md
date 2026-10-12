# getticketstub.com — project handoff for a new Claude chat

Paste this whole file into a new chat, then say what you want next.

## 1. What this project is

A cinematic, scroll-driven landing page for **getticketstub.com**. It sells commemorative event art: people who went to a game, gig or show (often bought through Ticketmaster and similar) get a keepsake stub made from that night.

The site was originally called ticketstub.com. The owner renamed it **getticketstub.com**, and every on-page mention now uses that name.

**The original brief** (keep honouring it):
- Look at least as polished as https://takeboost.com/, but **do not copy it**.
- Every ticket has its **own scene** matching its event (concert, sports game and so on), with **side imagery that relates**, e.g. a football player throwing the ticket.
- Use **Blender** to generate the ticket-stub asset **and** the ticket animation that plays through the scroll.
- As you scroll, the tickets fly across the screen **one by one, slowly, then all at once**, with **paper-material flight physics**.
- They fill a **corkboard** until it is **completely full**, then a **"Make yours!"** call to action appears.
- Rate the result with **independent reviewer subagents**; the score must be **above 80%**.
- **Before every independent review, update the artifact** so the owner can review it too.

**Owner preferences:**
- Any instructions about lajefahemp.com apply only when that project is named. This project is not that one.
- The owner may interrupt or redirect at any time. If they reject a tool call, stop and wait for them.

## 2. Where everything lives

**Live page (Claude artifact):** https://claude.ai/artifact/LPQUiDHBDcT5wBEuBXNqY3 (version 19 at handoff).

Always republish to this same URL. In a new chat, first run Artifact `read` on the URL, then publish with `url` set to it.

**Published files inside the artifact** (fetch them with Artifact `read` and `paths`):

| Path | What it is |
|---|---|
| `index.html` | The whole page (~135 KB): HTML, CSS and JS inline, a module script for three.js |
| `assets/ticketstub.gltf.json` | Blender export: stub mesh, board, frame, pin and 216 animated flight objects; base64-embedded buffer, ~1.6 MB |
| `assets/flight.json` | Flight metadata and per-frame shape-key weights, ~560 KB |
| `assets/qb.webp`, `pitcher.webp`, `singer.webp`, `hoops.webp` | AI-generated cut-out performers |
| `assets/hockey.webp` | Slapshot cut-out (Gerhard Crous / Unsplash) |
| `assets/stub-art-glasgow.webp` | Night artwork from the owner's TicketStub app |
| `assets/ballet.webp`, `fan.webp`, `keeper.webp` | Unused leftovers |
| `src/build_tickets.py.txt` | The Blender build script; rename it to `.py` |
| `src/glb_to_json.py.txt` | GLB → `.gltf.json` converter |
| `src/shoot.py.txt` | Playwright screenshot harness |
| `src/fonts.css` | Harness font mapping |
| `src/BRIEF.md.txt` | The independent-review brief |

**Last working directory layout.** The cloud workspace is wiped between sessions, so rebuild this from the artifact:

```
/home/claude/ts/site/index.html, site/assets/*
/home/claude/ts/blender/build_tickets.py, glb_to_json.py
/home/claude/ts/test/shoot.py, fonts.css, f/*.woff2, node_modules (three@0.160.0, lenis@1.1.13, @fontsource*)
/home/claude/ts/review/BRIEF.md, review/<ReviewerFolder>/
```

## 3. Page structure (top to bottom)

1. **Loader:** a thermal-printer animation.
2. **Nav:** colour follows the section underneath; it hides on scroll-down and goes frosted (`.nav.solid`) once off the hero. Links: The stubs · How it works · Studio · The wall.
3. **Hero `#hero`:** "YOU / WERE / THERE." with an outlined last line, a red disc with circular text, and a 3D Blender stub ("YOUR NIGHT") that tilts and flies off on scroll.
4. **Marquee:** a slanted ink band.
5. **Statement:** "Your phone kept a QR code. It forgot the night." A phone with a QR code beside a physical stub.
6. **Scenes intro `#scenes`:** "Five nights · five stubs" and "Every night gets its own stub."
7. **Five pinned event scenes, `.scene[data-i]`,** ~260vh each:

   | data-i | Event | Big word | Performer |
   |---|---|---|---|
   | 0 | Football | GAMEDAY | quarterback |
   | 1 | Baseball | FIRST PITCH | pitcher |
   | 2 | Concert, "Nova Riot" | ENCORE (behind the singer) | singer |
   | 3 | Basketball | TIP-OFF | player |
   | 7 | Hockey | OVERTIME | slapshot; stub leaves the stick blade |

   Indices 4–6 (soccer, festival, theatre) still exist in the data but have no scene: their photos didn't show a throw.

   In each scene the performer's cut-out sits at the side and the Blender stub is thrown from the hand anchor (`SCENES[i].anchor`). Throw progress is 0.1–0.9 of the scene. Each scene has its own palette, line-art motif, bokeh and an outline-to-fill big word.
8. **Interlude:** "One stub is a memory. A wall of them is a life."
9. **How it works `#how`:** three steps with visuals.
10. **Studio `#studio`:** the owner's TicketStub app graphics, added on request.
    - Left column: the TS stamp mark, the TicketStub wordmark (inline SVG symbols `#tsStamp` and `#tsWordmark`), a Fraunces headline "Turn your ticket into a stub worth keeping.", and a paste-link form plus "Try" chips that open the app at https://gvk66o79l1.c38.airoapp.ai/ (demo links `/new?demo=neathack|pale|harbour`).
    - Right column: three cards pinned on a cork-and-walnut panel. They were **restyled to the page theme** at the owner's request: halftone colour art panel, outline/fill word, Archivo caps title, IBM Plex Mono details, Big Shoulders number boxes, a tear-off stub with notches and perforation, and a page-style back with red bars and a faint repeating "getticketstub". Pointer tilt moves a gold/red foil sheen (on phones it follows scroll), a click flips a card, and "Tear to finish ✂" flips all three.
    - The left column still uses the app's look; the owner was asked whether to switch it too and **hasn't answered yet**.
11. **Gallery "Hot off the press":** a drifting ribbon of canvas-drawn stubs.
12. **Corkboard `#wall`, 560vh:**
    - Progress 0.03–0.40: the 5 scene stubs land one by one (scene order) with red pins, while the camera leans in.
    - 0.40–0.76: the all-at-once swarm (83 stubs on desktop, 111 on phone, which uses a portrait wall) fills the board to ~99.8%.
    - Above 0.79: the "Make yours!" CTA with an event input and live canvas preview.
    - The "on the wall" tally counts up throughout.
13. **Footer:** outlined "getticketstub" bigmark, a "Make yours" button, link columns including "Open the studio app ↗", and photo credits.

**Stack:** three.js r160 and Lenis 1.1.13 from jsdelivr, loaded via an import map. Google Fonts: Archivo (wdth/wght), Big Shoulders Display, IBM Plex Mono, Abril Fatface, Fraunces, Inter Tight. Theme tokens: `--ink #15100c`, `--stock #f1e7d3`, `--punch #e8432a`, `--foil #f2b33d`.

**WebGL details:**
- A fixed canvas at z-index 6, a perspective camera at fov 30 and z 32, RoomEnvironment lighting, VSM shadows.
- Keyframes are sampled through interpolants, with **scroll as the clock**. Morph weights come from `flight.json`, and ticket faces are canvas-drawn per event.
- A no-WebGL fallback exists: 2D stubs and a static wall, plus a `webglcontextlost` handler and a 30-second safety timer.

**Artifact limits:** scripts may only come from approved CDNs, so assets travel as published `files`. `.glb` can't be served, which is why it is converted to `.gltf.json`.

## 4. Blender pipeline (`build_tickets.py`, pip `bpy` 5.2, ~5 min headless)

Run `python3 build_tickets.py`, then `python3 glb_to_json.py ../site/assets/ticketstub.glb ../site/assets/ticketstub.gltf.json`. It writes into `../site/assets/`.

**Card and mesh:**
- A 300 gsm card, 15 × 5.5 cm (scene units L=3, W=1.1, `UNIT` = 0.05 m), with die-cut corners and perforation notches at x = 0.88 and real thickness.
- Five shape keys: `bendL`, `bendW`, `twist`, `wave`, `stub`. The stub key is a smooth fold, not a crease.
- Front, back and edge materials, plus a corkboard (16 × 10), a mitred walnut frame with UVs, and a push pin.

**Physics:**
- A quasi-steady flat-plate model: angle-of-attack normal force, skin friction, a centre-of-pressure torque (weathervane and flutter) and damping.
- RK4 integration at 600 Hz, with Newton shooting on the launch velocity to hit each target, then keyed in slow motion.
- Flex comes from the aero-load history through damped oscillators.
- Board flights blend to a flat landing pose and are lifted so they never dip into the cork.

**Objects:**
- `S0`–`S7`: scene throws, frames `i*120 … +100`. Targets are (−side × 7.2, ~−0.4, 3.5), and the best of 12 attempts is chosen for a face-on, upright flight.
- `B00`–`B87`: landscape wall. 5 heroes (football, baseball, concert, basketball, hockey), released face-on and upright, from frame 1000 with a 96-frame stagger and 92-frame flights; then the swarm from about frame 1506. End frame is 1644.
- `P00`…: portrait wall for phones.
- Coverage is ~99.8%, with pins placed only where no later stub covers them.

The animations are exported as glTF ACTIONS (one action per object, linear keys; visibility via scale 0/1). `flight.json` carries `meta` (fps, throws, heroes, swarm, heroesP, swarmP, frames, coverage) and `weights[name] = {start, w: [[5 floats] per frame]}`.

## 5. Test harness (`shoot.py`)

Playwright with SwiftShader WebGL. It serves `site/` locally and maps the CDN and Google Fonts to local copies: `npm i three@0.160.0 lenis@1.1.13 @fontsource-variable/archivo @fontsource/big-shoulders-display @fontsource/ibm-plex-mono @fontsource/abril-fatface @fontsource-variable/fraunces @fontsource-variable/inter-tight`, then copy the needed `.woff2` files into `test/f/` (the names are in `fonts.css`).

```
cd /home/claude/ts/test
PORT=8765 VW=1440 VH=900 WAIT=3000 SHOTS='[["hero",0],["s0",[".scene[data-i=\"0\"]",0.3]],["w",["#wall",0.5]]]' python3 shoot.py [outdir]
# optional EVAL='<js expression>' runs before each screenshot; it writes site/_w<PORT>.html (delete before publishing)
```

**Gotchas:**
- The swarm renders slowly in software: use WAIT ≥ 5000.
- In this headless renderer, a lazily loaded `<img>` inside a CSS-masked element can paint blank. The studio art uses eager loading for this reason.
- The browser can't open `localhost`; use the harness for checks and the artifact for viewing.

## 6. Review process and score history

Brief: `review/BRIEF.md` (artifact `src/BRIEF.md.txt`). The weighted criteria are polish ×3, originality ×1, event scenes ×2, motion/physics ×2, full corkboard plus CTA ×1, Blender use ×1, responsiveness ×1 and copy ×1.

Launch **two general-purpose subagents in parallel**, each with its own `PORT` and its own `review/<Name>/` folder. **Republish the artifact first** and tell the owner.

| Round | Scores |
|---|---|
| 12 | 79, 77.5 |
| 13 | 79, 77 |
| 14 | 78, 80 |
| v15 onward | **not yet reviewed**: the owner stopped the round-15 reviewers, then asked for the rename, the app graphics and the card restyle |

v15–v19 changes since the last scores:
- A new slapshot hockey photo, with the stub leaving the stick blade.
- Landings lifted so stubs no longer sink into the cork.
- Scene throws that stay on screen longer.
- The wall camera clamped so the frame always fills the view.
- A bigger hero stub.
- ENCORE moved behind the singer.
- The getticketstub.com rename.
- The Studio section with the owner's app graphics, and its cards restyled to the page theme.

**Reviewers' most frequent remaining asks:**
- A bigger, more sculptural 3D hero, closer to takeboost's bottle.
- Cleaner cut-out edges, especially the singer's hair.
- Edge-on swarm stubs reading as dark slivers.
- Phone corkboard framing: stubs cropped at the edges, and empty bands.
- More life in the gallery.
- Bring back the soccer, festival and theatre scenes if real throwing imagery can be found. The flights already exist (S4–S6), and Gamma image credits ran out.

## 7. Suggested next steps

1. Ask the owner whether the Studio left column should also switch to the page's style (the question is still open).
2. Republish, tell the owner, then run two fresh reviewers. Continue until **both** score above 80%.
3. Fix whatever the reviewers rank highest, starting with the hero 3D centrepiece and phone corkboard framing. Republish before every review round.
