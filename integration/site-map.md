# Current one-page inventory (LP-01.A)

Observed against landing `1d8379d1c5b0cb89ef869ea2cc7358886c9cf274` on 2026-10-12. Product and frontend owns content; a named product approver and approval receipt are pending. The current implementation is one public page at `/`; no separate public pages are generated. This map records existing content and explicit decisions, not approved capability/commerce claims.

| Surface | Existing anchor / location | Purpose and audience | v1 disposition | Content owner / remaining evidence |
|---|---|---|---|---|
| Hero | `#top`, `#hero` | Personalized commemorative stubs for concert/festival/sport memories and gifts | Included; primary CTA slot points to `#make` | Product and frontend; evidence-backed messaging under LP-02 |
| Problem and benefits | `.statement` immediately after hero | Contrast digital admission with a keepsake and describe the intended output | Included; no separate anchor currently | Product and frontend; material/fulfillment claims require approval |
| Example scenes | `#scenes`, generated `#scene-list` | Eight illustrative event scenes showing audience variety | Included as illustrations, not customer/order evidence | Product and frontend; LP-04 provenance and public-use review pending |
| How it works | `#how` | Explain event input, design and keepsake intent | Included | Product and frontend; supported runtime and commerce evidence pending |
| Studio detail | `#studio` | Describe event details and show interactive sample stubs | Included illustrative demo | Product and frontend; not an integrated host studio |
| Sample gallery | `.gallery` after studio | Show sample designs | Included illustrative examples; no separate anchor currently | Product and frontend; LP-04 |
| Wall / benefits | `#wall` | Show keeping multiple memories together | Included; static fallback plus animated rendering | Product and frontend; LP-05 browser/accessibility checks pending |
| Demonstration CTA slot | `#make`, maker at `#maker` | Take an event or ticket link to the studio | Existing slot retained; destination and data/query behavior are LP-03 review work | App technical owner + Product and frontend; no approved handoff claimed |
| About / hackathon | Footer product identity and studio attribution | Identify product purpose | Existing attribution included; a dedicated about/hackathon section deferred until approved facts and owner exist | Product and frontend; current page has no about anchor |
| Pricing | Existing inline copy in process/maker | Commercial price and delivery claim | No separate pricing page; existing inline claims require LP-02/LP-03 evidence or withdrawal before release | Commerce owner + Product and frontend |
| Waitlist, signup, contact | Absent | Optional capture/support entry | Omitted; no nav items or receiver/data contracts | Owner and data handling contract absent |
| Request demo / early access | Absent | Optional conversion surface | Omitted; no nav items | Product owner/destination absent |
| Separate demo or about page | Absent | Optional standalone content | Omitted; single page scope | Product approval absent |

Header: logo → `#top`; The stubs → `#scenes`; How it works → `#how`; Studio → `#studio`; The wall → `#wall`; Make yours → `#make`. Footer repeats scenes/how/studio/wall/make, plus product identity and existing illustration/photo attribution. Hero secondary navigation points to `#scenes`. The skip link and footer primary CTA point to `#make`.

Stable navigation anchors already implemented: `top`, `hero`, `scenes`, `how`, `studio`, `wall`, `make`. Problem/benefits, gallery and about do not yet have independent anchors; adding them needs a coordinated source/navigation edit under LP-02/LP-05. This foundation does not report the requested complete section-anchor inventory or product approval as achieved. The page's existing form and external studio destination are preserved here, not approved by a build pass.

Acceptance remains partial: LP-01.A product approval and complete section-anchor coverage are pending; LP-01.B has local executable evidence; LP-01.C needs app-owner agreement and actual-host smoke; LP-01.D preserves the original architecture docs/PR #1 and does not alter central acceptance states.
