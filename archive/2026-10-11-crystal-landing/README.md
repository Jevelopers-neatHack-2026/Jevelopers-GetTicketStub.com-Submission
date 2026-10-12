# Crystal landing page

The getticketstub.com landing page: a cinematic, scroll-driven page for personalized ticket stub keepsakes.

- **Live page:** https://claude.ai/artifact/LPQUiDHBDcT5wBEuBXNqY3 (opens for anyone once the owner shares it with "anyone with the link")
- **Source:** [`index.html`](index.html) plus [`assets/`](assets/), a single self-contained page

## What's on the page

Hero ("Keep the night.") → the problem → five event scenes where a performer throws a 3D stub → how it works → the studio → sample gallery → a corkboard that fills with stubs → the "Make yours!" form → footer, then a seamless loop back to the hero.

The form sends the ticket link or typed event to the TicketStub studio app (`STUDIO_URL` in `index.html`).

## Run it locally

The page loads its 3D model and flight data with `fetch`, so open it through a local web server rather than as a file:

```sh
cd landing/crystal
python3 -m http.server 8080
# then open http://localhost:8080
```

## Assets

| File | What it is |
| --- | --- |
| `assets/ticketstub.gltf.json` | Blender export of the stub, pins and corkboard (glTF with embedded buffer) |
| `assets/flight.json` | Baked paper-physics flights and shape-key weights |
| `assets/*.webp` | Performer cut-outs for each event scene |

Libraries load from jsDelivr (three.js r160, Lenis 1.1.13, Motion 11.11.17) and fonts from Google Fonts.

Event names on the page are illustrative. The stubs are commemorative keepsakes, not admission tickets.
