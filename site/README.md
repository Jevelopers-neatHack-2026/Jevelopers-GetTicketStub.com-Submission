# Crystal landing page

The TicketStub landing page: a cinematic, scroll-driven page for personalized ticket stub keepsakes.

It explains what TicketStub makes (personalized commemorative ticket stubs), who it's for (people keeping a concert, festival, game or once-in-a-lifetime night, and gift buyers), and why it matters ("The event ends. The memory deserves something you can hold onto.").

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The whole page: markup, styles and scripts in one file |
| `assets/ticketstub.gltf.json` | Blender export of the stub, pins and corkboard (glTF with embedded buffer) |
| `assets/flight.json` | Baked paper-physics flights and shape-key weights |
| `assets/*.webp` | Performer cut-outs for the event scenes |

Libraries load from jsDelivr (three.js r160, Lenis 1.1.13, Motion 11.11.17) and fonts from Google Fonts. There is no build step.

## Run it locally

The page loads its 3D model and flight data with `fetch`, so serve the folder rather than opening the file directly:

```sh
cd site
python3 -m http.server 8080
# then open http://localhost:8080
```

## Page order

Hero ("Keep the night.") → the problem → five event scenes where a performer throws a 3D stub → how it works → the studio → sample gallery → a corkboard that fills with stubs → the "Make yours!" form → footer, then a seamless loop back to the hero.

The form sends the ticket link or typed event to the TicketStub studio app (`STUDIO_URL` in `index.html`). Price and shipping shown on the page: $9.99 a stub, ships within 72 hours.

Event names on the page are illustrative. The stubs are commemorative keepsakes, not admission tickets.
