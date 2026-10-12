# Bounded mobile header fit — actual negative and candidate controls

Refs #7 and #17. Root's [source-pinned baseline receipt](baseline-browser.json) names `54dce1810a5e00d30580e614c8244f9b4ca67c15`, page SHA-256 `9c3b80588cfa0e4c226e04102f0b14e6bb820fb0d88c61b2965bdd8f01038159`. With fonts loaded, the 196.03125px logo and 178.25px CTA stayed on one flex row. CTA right was 390.28125px: 30.28125px outside the 375px viewport's 360px client width and 85.28125px outside the 320px viewport's 305px client width. Actual screenshots: [375px baseline](baseline-375.jpg), [320px baseline](baseline-320.jpg).

Candidate source `096fe76f8f559ac504693168e3cd6068337d0bb3`, page SHA-256 `a078774df18e59b884bdff968f2bec3e4a5b2a009458d30c8320242f595858f6`, adds a rule only at ≤440px. The header can wrap with an 8px gap; its intrinsic-width CTA aligns right without shrinking its text or artwork. Hero and maker reserve 114px plus safe-area clearance for the two-row header. The narrow maker uses the existing scrollable/start-aligned layout so added clearance does not make controls unreachable. Labels, anchors, scripts, fonts, copy and image assets are unchanged. The copy/proof page hashes and privacy stylesheet hash were refreshed for this CSS change; owner/publication approvals were not fabricated.

## Actual candidate browser observations

Root's [candidate receipt](candidate-browser.json) names the exact candidate and page hash at loopback `http://127.0.0.1:4180/`. This is existing-profile Chrome/static fallback with WebGL unavailable, not public deployment or release acceptance. `evidence.json` binds receipts, actual screenshots, artifact manifest, code/test hashes and raw local command outputs.

| Action | Recorded result |
|---|---|
| 375×812 loaded-font header | CTA left 165.75, right 344 within client 360; logo right 212.03125. Header bottom 99.375; hero-top text begins 114. |
| 320×568 loaded-font header | CTA left 110.75, right 289 within client 305; logo right 212.03125. Header bottom 99.375; hero-top text begins 114. Both sizes retain 16px right clearance. |
| Stable 375 reload / logo link | Root returned to `#top` with page scroll 0; header bottom 99.375, hero-top text 114..166, disc 192..424.5. The [stable screenshot](candidate-375-stable.jpg) is the preferred 375px visual. The earlier [375px capture](candidate-375.jpg) caught an unsettled resize/art position and does not certify art layout. |
| 320 maker entry | Header was hidden by the existing scroll behavior; heading top 357.95. Initial input top 583.61 was below the 568px viewport, in a scrollable maker (`scrollHeight:1109`). This initial state is not called a full visibility pass. |
| 320 empty Enter | Focus `ev`, invalid true, input moved to 255.61..311.61 and became visible. |
| 320 fictional preview / wheel | No form; location stayed local `#make`; studio href stayed exact with no copied input/query. Maker wheel reached scrollTop 331; studio link 519.39..536.28 was visible. [Actual maker screenshot](candidate-maker-320.jpg). |
| 375 maker entry / empty Enter | Input initially 575.98..631.98 within 812px viewport; empty Enter kept focus `ev`, invalid true and moved it to 377.98..433.98. |

These actual measurements support the bounded header-fit/clearance correction. They do not establish every page's reflow, full keyboard order, physical touch/scrollbar behavior, screen-reader announcements, contrast, privacy, performance or deployed revision. Broader document overflow previously observed at 768/1440px and maker text/art readability remain unresolved. No broader responsive or WCAG pass is inferred. Root restored temporary viewport/media settings.

## Local checks and remaining release boundary

[Raw command records](reports/commands.json) and adjacent stdout/stderr logs retain actual execution times, executable arguments and exit codes on Node 24.15.0:

- All seven existing test files: 104 passed, 0 skipped, exit 0. No modeled CSS geometry test is used as browser proof.
- Foundation draft: `PASS_LOCAL`; content, proof, CTA, privacy, metadata and UX draft: `PASS_DRAFT`, all exit 0.
- UX release: nine real-handler scroll tests passed, then exit 1 for missing full browser/manual/performance evidence.
- Source audit confirms visible text and script blocks unchanged; the exact asset digests are retained in the [artifact manifest](reports/artifact-manifest.json).

The earlier 54dce18 reports/zero-rectangle resize observations are historical. Fresh baseline and candidate controls above supplied nonzero geometry; this does not rewrite earlier inconclusive results. Publication by this task: `NOT_DEPLOYED`; public landing identity: `UNKNOWN`. The broader UX/release gates and owner acceptance remain pending. No issue or master acceptance ID is closed.
