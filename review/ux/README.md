# Selected MVP UX evidence — partial local validation

Scope: the existing illustrated landing page, the entry into a separately owned product experience, and recovery from the scrolling failure in #17. Refs #7, #17 and #12. PR #18's native-scroll fix and PR #21's fallback initialization are already merged; this work adds checks and records evidence, without a redesign or source-page changes. Product and frontend plus an accessibility/QA reviewer remain responsible for acceptance.

The customer MVP is research → edit → generation → revision → approval → export → sandbox quote → exact authorization → sandbox order. This repository checks the public explanation and entry boundary; a landing click or digital preview proves none of those downstream outcomes. CTA implementation is coordinated under LP-03, not duplicated by this UX work.

## What was checked locally

`local-source-observation.json` records the exact historical page/artifact hashes, validator/test hashes, source revision, Node version and actual command outcomes. These pins identify the tested local page; they do not attest a public deployment. CTA source changes require fresh local and browser evidence on the final merged artifact.

```sh
node --test tests/ux.test.mjs
./scripts/validate-landing --suite ux --mode draft
./scripts/validate-landing --suite ux
```

The UX unit tests mutate the actual HTML to demonstrate detection of broken anchors, duplicate IDs, missing link/button/input names, a missing input description target, missing landmarks, duplicated page headings, main heading-level jumps, missing focus/reduced-motion source hooks, absent image alternatives and removed media-independent explanations. They cover the local preview group semantics coordinated with LP-03. The suite validates built source bytes and executes the nine existing actual-handler scroll regressions, including initialization/frame failure, context loss, native wheel recovery, progress updates and CTA focus with reduced motion on/off.

Draft status is `PASS_DRAFT`: the bounded checks passed with unresolved items. The release command exits nonzero because actual viewport, manual accessibility, failure-state and performance evidence are unavailable. This local validator has no browser/Lighthouse adapter; adding an unverified receipt string cannot make it pass release. A subsequent evidence adapter/review under #7 must validate actual recorded results before changing that boundary.

Static text remains present when image/canvas elements and scripts are removed from the fixture. This is **text availability**, not proof that users can see it with JavaScript disabled or missing media: the loader and maker visibility depend on script execution. The source hook checks do not measure computed style, focus visibility, contrast, touch geometry, browser layout, accessible names produced by scripts or screen-reader announcements. VM scroll results do not reproduce a physical trackpad, scrollbar drag or touch gesture.

## Current source concerns to inspect

- Board/maker `h2` elements precede the page `h1` in document order; the maker is outside `main`. The main landmark's static heading sequence passes the narrow source check, while the whole-document order needs browser/assistive-technology review.
- Footer headings begin at `h4` without local `h2`/`h3` context. The headline “Keep the night” also needs a reviewer to assess its product description together with adjacent text.
- Mobile CSS hides the normal `.fin-note`; `.fin-note.err` has a source rule to display errors. Actual error and unavailable-destination announcements/visibility must be checked after LP-03 integration.
- The loader, offscreen/inert maker, generated scene titles/image alternatives and image dimensions need real failure/reflow inspection. Source placeholders or fallback text are not measured layout reservations.

These are unresolved review items, not fabricated WCAG findings or cleared defects. The suite reports them beside local results. No WCAG 2.2 AA conformance, performance budget pass or universal device support is asserted.

## Actual deployment identity

`deployment-observation.json` is a sanitized read-only GET observation from 2026-10-12. The existing `https://gvk66o79l1.c38.airoapp.ai/` destination responded HTTP 200 using a curl-style user agent. An earlier default Python user agent received HTTP 403; client-dependent access is not a definitive outage. Only the public root document was retrieved: no typed values, form submission, generation, provider call or paid action occurred.

The retrieved response SHA differs from this repository's landing HTML SHA. No matching landing manifest/asset provenance or deployed landing commit was supplied. This URL is the separately owned product preview, not an approved landing deployment. **Actual deployed landing revision is unknown.** HTTP success, a product health version, a title or a screenshot cannot prove that PR #18/#21 or the final landing artifact is deployed. Before validating #17 and #12 in public, establish the owner-approved landing URL, exact landing/host SHAs and deployed asset/manifest hashes; compare actual served bytes with the build, then run the input matrix there.

## Required browser/manual record

Root is performing the browser review; results are pending here. Serve the exact artifact locally using `node scripts/build.mjs` and `node scripts/preview.mjs --port 8080`. Retain a reviewed `review/ux/browser-record.md` (or structured equivalent) with the source SHA, manifest hashes, consuming-app/CTA decision, timestamp, browser/OS/device/input versions, reviewer, actual screenshots/reports and each pass/fail/blocked result. Do not substitute a synthetic receipt, mock timing value or screenshot placeholder.

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
