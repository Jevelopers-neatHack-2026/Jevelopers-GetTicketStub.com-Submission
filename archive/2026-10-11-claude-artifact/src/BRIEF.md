# Independent review brief — ticketstub.com landing page

You are an independent senior web-design / creative-tech reviewer. You did NOT build this. Be strict and honest; do not inflate scores.

## What the client asked for (verbatim intent)
- Analyze https://takeboost.com/ and build a website that looks like something similar, *at least at that level*, but **don't copy it**.
- The site is for **ticketstub.com**: a place for commemorative event art — people who attended events (e.g. bought via Ticketmaster) generate a keepsake stub from events they attended.
- All the tickets have their own scene matching the event (concerts, sports games etc).
- Use **Blender** to generate the ticket-stub asset and the animation of the ticket throughout the scrolling of the page.
- As you scroll, tickets fly across the screen **one by one, slowly, and then all at once**.
- Tickets should respect the **physics of flying at speed based on their paper material**.
- They fill in a **corkboard**; at the end the corkboard is completely filled and there is a CTA saying **"Make yours!"**
- On the side of the page there should be **pictures that relate to the events** (e.g. a football player throwing the ticket).

## The reference: takeboost.com
You may WebFetch https://takeboost.com/ for its copy and structure. Observed visual traits: branded loader; big photoreal 3D product (bottle) that tilts/rotates with scroll; huge extended grotesk all-caps type; outline-vs-filled type toggling for the active item; full-bleed saturated gradient backgrounds that change per section (orange → purple → lavender → cream); 3D-rendered objects (berries, orange slices, zinc crystals) flying in with parallax; large circular outline graphics; tilted review cards; marquee slogans; playful copy; custom scroll thumb.

## What was built
- Page source: `/home/claude/ts/site/index.html` (single page; three.js r160 + Lenis from CDN, everything else inline). Assets in `/home/claude/ts/site/assets/`.
- Blender build script: `/home/claude/ts/blender/build_tickets.py` (bpy, Blender 5.2). Output `ticketstub.glb` (served as `ticketstub.gltf.json` via `glb_to_json.py`) + `flight.json` (per-frame shape-key weights + metadata). The script takes ~5 minutes; you do not need to re-run it (if you do, copy it into your own folder and change OUT so nothing in site/ is overwritten).

## How to look at it
A Playwright harness renders the page locally with WebGL (SwiftShader) and maps CDN/fonts to local copies:
```
cd /home/claude/ts/test
# SHOTS is a JSON list of [name, target]; target = pixel scrollY, or [cssSelector, progress 0..1 through that section]
PORT=<your port> VW=1440 VH=900 WAIT=3000 SHOTS='[["hero",0],["s0",[".scene[data-i=\"0\"]",0.3]]]' python3 shoot.py /home/claude/ts/review/<your-folder>
```
(The harness writes a throwaway `_w<PORT>.html` wrapper next to the page; that is expected.)
Sections: `#hero`, `section.statement`, `#scenes` (intro), `.scene[data-i="0|1|2|3|7"]` (five pinned event scenes: football, baseball, concert, basketball, hockey; each ~260vh; progress 0.1–0.9 is the throw), `.interlude`, `#how`, `.gallery`, `#wall` (corkboard, 560vh: 0.03–0.40 the five scene stubs land one by one, 0.40–0.76 all-at-once swarm, >0.79 "Make yours!" CTA), footer.
Software WebGL is slow: use WAIT≥3000 (≥5000 for the corkboard swarm) and expect a few minutes per run. Look at the screenshots with the Read tool (images). Take as many as you need (desktop 1440×900 AND phone 390×844), including several progress points in the same scene to judge the motion.
Do NOT modify anything in /home/claude/ts/site or /home/claude/ts/blender. Write only inside your own folder under /home/claude/ts/review/.

## Score it
Score each criterion 0–10, then give an overall % (weighted average ×10):
1. Visual design quality / "at least takeboost level" polish (weight 3)
2. Originality — clearly not a copy of takeboost (weight 1)
3. Event scenes: every ticket has its own matching scene + side imagery that relates (performer throwing the ticket) (weight 2)
4. Motion: one-by-one slow fly-across, then all-at-once; paper-physics believability (weight 2)
5. Corkboard completely filled at the end + "Make yours!" CTA (weight 1)
6. Blender genuinely used for asset + animation (weight 1)
7. Responsiveness / technical robustness / legibility (weight 1)
8. Copy & brand fit for ticketstub.com commemorative stubs (weight 1)

Return: the per-criterion scores with one-line justifications, the overall %, and a ranked list of the **top 8 concrete fixes** that would raise the score most (specific: which section, what's wrong, what to change). Keep the report under 600 words.
