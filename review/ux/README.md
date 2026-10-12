# Selected MVP UX evidence — partial local validation

Scope: the existing illustrated landing page, the entry into a separately owned product experience, and recovery from the scrolling failure in #17. Refs #7, #17 and #12. PR #18's native-scroll fix and PR #21's fallback initialization are already merged; this work adds checks and records evidence, without a redesign or source-page changes. Product and frontend plus an accessibility/QA reviewer remain responsible for acceptance.

The customer MVP is research → edit → generation → revision → approval → export → sandbox quote → exact authorization → sandbox order. This repository checks the public explanation and entry boundary; a landing click or digital preview proves none of those downstream outcomes. CTA implementation is coordinated under LP-03, not duplicated by this UX work.

## What was checked locally

`local-source-observation.json` now records source `54dce1810a5e00d30580e614c8244f9b4ca67c15`, page SHA-256 `9c3b80588cfa0e4c226e04102f0b14e6bb820fb0d88c61b2965bdd8f01038159`, manifest SHA-256 `e64d9bcaf5b26f0a1bc1d104e679a5f26a2f4fda30cde023dba506692bdc06ad`, every public artifact file, validator/test hashes, Node version, and actual commands/exit codes. The [retained build manifest](reports/54dce18/artifact-manifest.json) contains the artifact records. The [raw command records](reports/54dce18/commands.json) retain expanded executable arguments and execution times; adjacent `.stdout.log`/`.stderr.log` files preserve output, with log digests in the observation. These pins identify the local artifact, not a public deployment. `publicationState: NOT_DEPLOYED` means this validation run did not publish its local artifact; actual public landing identity remains `UNKNOWN`. UX/QA approval is `PENDING`.

The prior observation is retained unchanged as [historical b6ae55c evidence](history/local-source-observation-b6ae55c.json). Its 94-test count, old page digest, mobile-note warning and external form-era findings apply to that older source only. They are not current validation results. The current commands returned 17 UX tests and 104 repository tests passed, no skips; UX draft exited 0 with `PASS_DRAFT`; UX release exited 1 with its explicit missing browser/manual/performance evidence error. The draft/release invocations each executed all nine real-handler scroll tests.

```sh
node --test tests/ux.test.mjs
./scripts/validate-landing --suite ux --mode draft
./scripts/validate-landing --suite ux
```

The UX unit tests mutate the actual HTML to demonstrate detection of broken anchors, duplicate IDs, missing link/button/input names, a missing input description target, missing landmarks, duplicated page headings, main heading-level jumps, missing focus/reduced-motion source hooks, absent image alternatives and removed media-independent explanations. They cover the current local preview group semantics. The suite validates built source bytes and executes the nine existing actual-handler scroll regressions, including initialization/frame failure, context loss, native wheel recovery, progress updates and CTA focus with reduced motion on/off. The release test uses a unique OS-temporary repository containing copies of the actual source and scroll tests, preventing concurrent runs from deleting another test's artifact.

Current LP-03 source has a local `role=group` maker, no submitting form or named input, and `Update preview`/Enter only changes the local specimen. The owner-approved separate native `Open studio` link is exactly `https://getticketstub.com/make`, with no query/fragment or preview value copied. The former Airo GET form and input-to-query continuation were removed by PR #25; PR #26 enabled public navigation under the limited owner decision in [cta-navigation-decision.json](../cta-navigation-decision.json). This closes the old landing-authored input transmission path; it does not establish CDN/host privacy, deployed revision, downstream ordering or release approval. [The CTA contract](../../integration/cta-contract.md) records the scope.

Draft status is `PASS_DRAFT`: the bounded checks passed with unresolved items. The release command exits nonzero because actual viewport, manual accessibility, failure-state and performance evidence are unavailable. This local validator has no browser/Lighthouse adapter; adding an unverified receipt string cannot make it pass release. A subsequent evidence adapter/review under #7 must validate actual recorded results before changing that boundary.

Static text remains present when image/canvas elements and scripts are removed from the fixture. This is **text availability**, not proof that users can see it with JavaScript disabled or missing media: the loader and maker visibility depend on script execution. The source hook checks do not measure computed style, focus visibility, contrast, touch geometry, browser layout, accessible names produced by scripts or screen-reader announcements. VM scroll results do not reproduce a physical trackpad, scrollbar drag or touch gesture.

## Current source concerns to inspect

- Board/maker `h2` elements precede the page `h1` in document order; the maker is outside `main`. The main landmark's static heading sequence passes the narrow source check, while the whole-document order needs browser/assistive-technology review.
- Footer headings begin at `h4` without local `h2`/`h3` context. The headline “Keep the night” also needs a reviewer to assess its product description together with adjacent text.
- Current mobile CSS uses `.fin-note{display:block}` and preserves `#demoUnavailable` while typing. The old source warning for a hidden normal note is absent from the current observation. Actual status/error visibility and announcements still require browser and screen-reader results.
- The loader, offscreen/inert maker, generated scene titles/image alternatives and image dimensions need real failure/reflow inspection. Source placeholders or fallback text are not measured layout reservations.

These are unresolved review items, not fabricated WCAG findings or cleared defects. The suite reports them beside local results. No WCAG 2.2 AA conformance, performance budget pass or universal device support is asserted.

## Actual deployment identity

`deployment-observation.json` is a **historical** sanitized read-only GET observation from 2026-10-12 against source `b6ae55c`. The then-existing `https://gvk66o79l1.c38.airoapp.ai/` destination responded HTTP 200 using a curl-style user agent. An earlier default Python user agent received HTTP 403; client-dependent access is not a definitive outage. Only the public root document was retrieved: no typed values, form submission, generation, provider call or paid action occurred. Airo is now withdrawn; this is not an availability check of the current approved studio URL. This evidence refresh made no external HTTP request.

The historical response SHA differs from the historical landing HTML SHA. No matching landing manifest/asset provenance or deployed landing commit was supplied. That URL was a separately owned product preview, not an approved landing deployment. The current studio navigation decision likewise reports deployed revision `UNKNOWN`; it approves public navigation only. **Actual deployed landing revision is unknown.** HTTP success, a product health version, a title or a screenshot cannot prove that PR #18/#21/#25/#26 or source `54dce18` is deployed. Before validating #17 and #12 in public, establish the owner-approved landing URL, exact landing/host SHAs and deployed asset/manifest hashes; compare actual served bytes with the build, then run the input matrix there.

## Required browser/manual record

Root supplied the [raw local browser receipt](browser/54dce18/root-browser-evidence.json) at `2026-10-12T11:49:37.518Z`, naming source `54dce1810a5e00d30580e614c8244f9b4ca67c15` at `http://127.0.0.1:4179/`. Its actual JPEG is retained as [mobile maker screenshot](browser/54dce18/mobile-320.jpg); the receipt reports logical viewport 320×568, while the saved JPEG is 305×541 pixels. Receipt/image hashes and the local build manifest association are in `local-source-observation.json`. The receipt identifies the source commit but does not supply an independent served-byte manifest. The record is **PARTIAL_LOCAL_NOT_DEPLOYED**, using an existing browser profile and WebGL-unavailable static fallback. Browser/OS version is not provided.

| Recorded action | Actual observation | Scope |
|---|---|---|
| Root-reported reduced-motion maker at 320×568 | Maker `scrollHeight:1065`, `clientHeight:568`; native wheel moved its `scrollTop` from 0 to 497. | Confirms that local maker scroll in this state. Does not cover physical touch, every page dead zone or scrollbar dragging. |
| Empty Enter | Focus `ev`, `aria-invalid:true`, location remained local `#make`. | One input/error interaction, not a screen-reader announcement or complete keyboard audit. |
| Fictional Enter | Zero forms; local `#make`; external href stayed exactly `https://getticketstub.com/make`; status said preview text is not included. | Supports the current local editing/navigation boundary; no destination click or downstream result is reported. |
| Resize/reopen at 375×812, 768×1024, 1440×900 | Input and studio-link bounding rectangles were zero, both after resize and attempted reopen. Receipt reports the scene reset/possible asynchronous state. | **INCONCLUSIVE, NOT PASS.** No usable-maker, overlap or horizontal-reflow acceptance is inferred from these measurements. |
| Tab after preview | Focus observed on an `A` named `getticketstub.com`. | Single Tab observation, not complete tab order, visible-focus or no-trap acceptance. |

The screenshot contains ticket artwork behind explanatory/status text; no contrast or readability pass is asserted. Screen reader, 200% text zoom, contrast, full keyboard/input matrix, blocked dependencies/media, clean-profile privacy, and three-run mobile performance remain unmeasured. Neither source checks nor this partial browser receipt establish WCAG conformance or deployed identity. The resized zero rectangles must be reproduced with a stable visible maker before the target widths can be accepted. Release remains blocked.

To extend evidence, serve the exact artifact locally using `node scripts/build.mjs` and `node scripts/preview.mjs --port 8080`. Retain a reviewed browser record with the source SHA, manifest hashes, consuming-app/CTA decision, timestamp, browser/OS/device/input versions, reviewer, actual screenshots/reports and each pass/fail/blocked result. Do not substitute a synthetic receipt, mock timing value or screenshot placeholder. Local CUA results must remain separate from public deployment and from screen-reader, contrast, failure-mode and lab-performance evidence they do not measure.

| Scenario | Required actual evidence |
|---|---|
| 320, 375, 768, 1440 CSS px | Screenshot plus measured horizontal overflow/overlap; all navigation, example copy, maker and destination availability remain usable. Inspect narrow layout rather than relying on `overflow-x:hidden`. |
| Keyboard | Tab from the address bar, visible focus, skip link, each nav/CTA/example control and preview input; Enter/Space activation and no trap. Record before/after scroll positions for Page Down/Space/arrows. No mobile menu currently exists. |
| Scroll #17 | Forward/reverse wheel/trackpad, native scrollbar drag and supported touch over content/right rail, plus key input; record position, state and sanitized console errors. Programmatic scroll alone is insufficient. |
| Reduced motion | OS/browser reduced-motion enabled, full journey, readable static content, usable focus and scrolling; record motion actually observed. |
| Failures | Block images/fonts/animation CDN and WebGL, slow/offline network, JavaScript disabled where static content permits, invalid input and unavailable CTA. Confirm announced/readable error and pending states without concealed controls. |
| Accessibility | Agreed browser/OS/screen-reader pair with versioned manual headings/landmarks/control-name/status review; 200% text zoom and 320 px reflow; measured contrast. Retain automated accessibility output and resolve actual critical/serious findings. |
| Mobile lab performance | Three actual runs on the same artifact/profile; record browser/tool version, CPU/network profile and raw reports. Median LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms. No runs were performed by this worker; changes to these budgets require written Product/frontend rationale. |

Review the collected record and actual artifacts before expanding the executable release adapter. Pin any public-deployment reproduction separately from local browser results. Sanitize screenshots/logs and use only fictional details. LP-05.A/C have partial source/regression evidence; LP-05.B/D and deployment reproduction remain pending. #7, #17, #12 and EVAL-03/EVAL-04 remain open/unverified.
