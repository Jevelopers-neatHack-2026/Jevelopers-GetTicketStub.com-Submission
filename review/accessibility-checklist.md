# Static collateral checklist — MM-08-A/B/C

**Checked visual candidate:** `456053c5a12fa189f3c16a4cd9067a242e218031`. This followup adds evidence/baseline only; it does not change visual sources. Author inspection occurred 2026-10-11 UTC. Accountable marketing owner: user-assigned supervisor. Independent Astra High review: **pending**. Brand/publication approval: **pending**. PASS below means local author accessibility checks for the stated use, not final release approval.

The exact source/export/alternative/preview hashes, viewing sizes and variant coverage are in [accessibility-results.json](visual/accessibility-results.json). All five browser-rendered SVG/PNG pairs and all six preview PNGs are covered. No currently delivered variant is implicitly covered solely by a template pass.

| Asset / variant | Intended-size check | Contrast / labels / alternative | Result |
| --- | --- | --- | --- |
| Workflow SVG and PNG, 1440 × 900 | Native plus 960 × 600 presentation | Ink/cream ≥15.6455; cream/moss ≥11.6265; ink/orange ≥4.9865. Numbered states, approval and return-to-design branch; ordered Markdown alternative | PASS, author |
| Workflow presentation PNG, 960 × 600 | Minimum text 14.67px | Draft and planned/blocked labels remain visible; arrows supplement words | PASS, author |
| Synthetic mockup SVG and PNG, 1200 × 900 | Native plus 720 × 540 presentation | Minimum contrast 11.6265; fictional example, “not a product screenshot,” review before production; packaged alternative | PASS, author |
| Mockup presentation PNG, 720 × 540 | Minimum text 14.4px | Fictional/draft wording and qualification preserved | PASS, author |
| X SVG and PNG, 1200 × 675 | Native plus 390 × 220 feed | Minimum text contrast 4.9865; cyan rule 9.5027; draft/synthetic, approval, unverified results, docs CTA; packaged alt | PASS, author |
| X feed preview PNG, 390 × 220 | Minimum text 13px | No lost crop/status/CTA; complete message is also in alt text | PASS, author |
| HTML support source and desktop PNG, 1440 × 1200 | 20px HTML body/link; presentation diagram | Semantic heading, image alternative, meaningful text-equivalent link; ink/cream 15.6455 | PASS, author |
| HTML mobile viewport PNG, 390 × 740 | 20px body; vertical scrolling | Dense image hidden; ordered text visible; no horizontal overflow | PASS after fix, author |
| HTML full mobile PNG, 390px wide | Entire corrected page inspected | All four states and recovery path readable; actual Tab focus outline visible | PASS after fix, author |
| Redaction-before SVG and PNG, 800 × 500 | Native synthetic control only | Fake visible/metadata/accessible-text canaries deliberately present; not a release asset | EXPECTED NEGATIVE; RELEASE BLOCKED |
| Redaction-after SVG and PNG, 800 × 500 | Native synthetic control only | Ink/cream 15.6455, ≥24px; blank known region; safe alternative; metadata/text/pixel removal tested | PASS procedure check; rights/publication pending |

## Alternative-only review actually performed

The UI author read each packaged alternative without using its graphic, then compared it with the source and rendered image. These are author observations; a separate reviewer decision is still required.

| Alternative | Message recovered without image | Order / limitation / next action |
| --- | --- | --- |
| demo/diagrams/demo-workflow-alt-text.md | Intended synthetic context → design → human review → planned handoff | Four numbered states; hold/revise returns to design; no production/payment/product/sponsor/savings proof; owner approval pending |
| demo/screenshots/synthetic-stub-alt-text.md | Fictional The paper moon stub artwork; not a product screenshot | No real event/person/order; review facts/rights/destination and hold/revise before production |
| launch/assets/x-submission-alt-text.md | Draft TicketStub keepsake concept | Context/design/human review; approval before production; no verified product/sponsor results; pinned docs CTA, not live app |
| examples/synthetic/redaction-after-alt-text.md | Synthetic after-removal test with blank central region | Fake markers removed from source/pixels/metadata/description; procedure only, privacy approval pending |
| HTML image alternative and mobile ordered list | Conceptual four-state journey | Human approval, blocked handoff, return-to-design and no product/sponsor results; visible mobile text preserves full meaning |

All states are expressed in words or numbers; color and decorative tear lines add no required information. Audience copy does not depend on unexplained acronyms or the internal asset IDs.

## Failure, fix and recheck

- **Observed failure:** the initial 390px deck rendering scaled the four-column diagram to unreadably small labels. That capture is not delivered as a passed variant; its observation is recorded in the author verification history.
- **Fix in visual candidate 456053c:** mobile breakpoint hides the diagram and displays an ordered 20px text equivalent with qualification and recovery path.
- **Actual recheck:** `deck-mobile-390.png` and `deck-mobile-full.png` were reopened and inspected. Entire ordered workflow is readable, no horizontal overflow; real Tab event focuses the named link with a solid visible outline. The final browser receipt and image hashes identify the corrected bytes.
- **Failing contrast control:** cyan/cream 1.6464 and orange/cream 3.1376 fail 4.5:1 normal text and are rejected by the test suite. Neither is used as normal text in the released-to-review visual candidates. No brand threshold waiver is granted.

## Not applicable and remaining gates

Static PNG/SVG has no speech, caption timing, video controls or speaker-note container. HTML support has no audio/video or presentation speaker notes. Caption timing/accuracy and speech transcript: **NOT_APPLICABLE for current static exports**. Future final demo video: **PENDING**, must receive its own caption/transcript/timing review on exact final bytes.

No app keyboard, dynamic loading/error, checkout, payment or production behavior is demonstrated. The only HTML interaction checked is the local text-equivalent link. Independent review, brand subset/consumer contract, privacy/rights, content/destination and publication approval remain pending. Asset rights failures stay blocked even if an accessibility check passes.
