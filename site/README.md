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

Libraries load from jsDelivr (three.js r160 and Motion 11.11.17) and fonts from Google Fonts. The source page needs no bundler, while the repository's artifact builder copies the allowed file types and records their hashes. Page input uses native scrolling independently of animation rendering; the orange rail is a display-only progress marker. See the [repository quickstart](../README.md#quickstart) for the maintained artifact workflow.

## Run it locally

The page loads its 3D model and flight data with `fetch`, so serve it over HTTP. For an artifact preview, run from the repository root:

```sh
node scripts/build.mjs
node scripts/preview.mjs --port 8080
# then open http://127.0.0.1:8080/
```

For a source-only preview, `python3 -m http.server 8080 --directory site --bind 127.0.0.1` also works from the repository root. Neither preview proves the deployed host serves this revision.

## Scroll regression checks

Run the focused checks **from the repository root**, with the pinned Node.js **24.15.0** toolchain. They need no npm dependencies or external provider calls:

```sh
node --test tests/scroll.test.mjs
```

The tests execute the page's actual frame, fallback, anchor and progress handlers in Node's VM, with browser and scroll-engine doubles. They check wheel input after a stopped 3D loop (context loss or an animation exception), progress without rendering, readable fallback scene copy, reduced-motion anchors, maker focus and the immediate hero wrap. These are deterministic lifecycle checks, not a substitute for browser input testing.

For browser verification, scroll forward/backward over content and the right-edge marker, drag the browser's native scrollbar, and use Page Down/Space/arrows and touch where supported. Repeat with reduced motion and blocked CDN/WebGL dependencies. The rail should track the page and pass input through; anchors should still reach the scenes and maker. Native anchor animation duration now follows the browser's smooth-scroll behavior.

## Page order

Hero ("Keep the night.") → the problem → eight illustrative event scenes → how it works → the studio → sample gallery → a corkboard that fills with stubs → the "Make yours!" surface → footer, then a loop back to the hero. The [page inventory](../integration/site-map.md) records exact anchors and pending content decisions.

The maker updates a local illustrative preview. It does not submit an event or ticket link. A separate **Open studio** link, including its no-JavaScript fallback, navigates to `https://getticketstub.com/make` without copying input, a query or a fragment. The [CTA contract](../integration/cta-contract.md) records the limited public-navigation decision and the matching `src/content/cta.json` configuration. Deployed destination identity and full CTA/release acceptance remain separate checks. Existing copy showing $9.99 per stub and shipping within 72 hours is pending commerce/content approval, not a verified price or delivery commitment.

Event names on the page are illustrative. The stubs are commemorative keepsakes, not admission tickets.

Brand, example rights, responsive/manual review and release acceptance remain tracked in the [repository status](../README.md#status). Preserve the historical browser receipts under `review/ux/`; a passing source test is not a fresh browser or publication review.
