# Analytics deferred; demo data handoff requires review (LP-07)

Recorded 2026-10-12 from landing source `6d47c94`, with metadata-only PR #22 incorporated. This is a draft implementation decision for [LP-07 #9](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/9). Product and frontend owns purpose and the landing experience; Finance and reliability owns the privacy/data review. Named accountable owners and their approvals are **pending**. LP-03 #5 must establish the receiving application URL and handling behavior before release. This record does not close #9 or change EVAL-03/EVAL-04 acceptance.

Public analytics and telemetry are **deferred**. There is no provider, event collector, event schema, cookie, consent toggle, tracking dashboard or paid integration in this implementation. The measurement questions, if collection is later deliberately approved, are whether visitors reach an appropriate demo entry and whether the downstream application reports a confirmed outcome. A landing CTA expresses interest only. A click, preview update, external handoff, fallback link or tab losing focus proves no signup, purchase, printed object or delivery.

The current page is **not a no-network or no-collection baseline**. Its local preview and public assets are distinct from the external form handoff and third-party code below. Deferring analytics does not make the form private or establish CDN behavior.

| Flow | Current behavior and recipient | Boundary / unresolved review |
|---|---|---|
| Page and art | Host serves HTML, eight WebP scene images, `assets/flight.json`, and `assets/ticketstub.gltf.json`. The model's buffer is embedded as a data URI. | Hosting/access logs, retention and deletion belong to the eventual host; not inspected here. |
| Fonts | Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`; Google Fonts CSS names Archivo, Big Shoulders Display, IBM Plex Mono, Abril Fatface, Fraunces and Inter Tight, then the browser can fetch font files. | Network identifiers, user agent and browser-dependent request/referrer information reach Google. Exact response-selected font URLs/storage behavior need clean-browser evidence. |
| Animation libraries | jsDelivr loads Motion `11.11.17` and Three.js `0.160.0`; import map permits Three addons, including GLTFLoader and RoomEnvironment and their transitive imports. | Versioned URLs are not content integrity pins. Executed CDN code and transitive requests/storage were not certified by a VM/source scan. |
| Typed or fictional example details | Real maker handlers parse text into an illustrative card in memory. No landing-authored network call or persistence is made by these handlers in the local harness. | This does not inspect CDN code or browser extensions. Test fixtures contain synthetic data only. |
| Submit / continuation | Native GET form and fallback link navigate to `https://gvk66o79l1.c38.airoapp.ai/?link=…` in a new tab. `link` contains entered text; the native form can encode whitespace differently from the fallback. | Text can include sensitive material despite the public-event label. The URL can enter destination logs, browser history and other URL-handling systems. Recipient ownership, retention/deletion, notice and accepted input remain unconfirmed under LP-03. No external demo request was made during validation. |
| Local diagnostics | Two existing `console.warn` calls report animation initialization/frame errors; they are retained and exactly covered by the executable audit. | These are not remote telemetry. Browser/library error objects may contain technical asset details; any added input logging or warning change requires review. |

`review/privacy-inventory.json` pins the existing executable script blocks, stylesheet bytes and markup tags, resource link URLs, import map, external Motion script and demo destination. It is an author audit marked `PENDING`, not approval. Metadata canonical/social URLs and JSON-LD are declarations, not tracking requests, and do not change executable hashes; meta refresh/header behavior is rejected. The build manifest separately checks every public file against source bytes. This conservative baseline audit is not a general HTML/JavaScript security parser or an exhaustive runtime privacy audit.

## Executable local checks

Use the repository's pinned Node version (`.nvmrc`: 24.15.0); no package install, provider or collector is needed:

```sh
node --test tests/privacy.test.mjs
./scripts/validate-landing --suite privacy --mode draft
./scripts/validate-landing --suite privacy
```

The first two commands validate the draft boundary. The third defaults to release and **fails** while the real approval receipt and browser evidence are absent. A missing required check is not a pass. The suite validates built bytes, rejects unreviewed SDK/resource destinations, collection controls, inline handlers, executable URLs, CSS requests, logging and storage/beacon APIs. Pinned scripts/styles catch computed API changes and local tracking URLs that a token scan alone can miss. Conservative restrictions require re-audit when public code or resource surfaces change.

The VM harness executes the real maker and all existing in-page link handlers with collection/network/storage/logging surfaces throwing blocked/failure errors, with reduced motion on and off. It exercises empty submission, fictional example chips, typed preview updates, CTA focus/navigation, native handoff permission and the delayed fallback. Its stubs record attempted forbidden operations even if page code swallows the error; seeded tests prove these traps fail. There is no imaginary enabled collector or declined-consent implementation: collection has no enabled path and no consent UI to test. No-collection source behavior and continued navigation are local findings, not browser attestations. Existing scroll tests cover animation fallback separately.

## Required release evidence

Before recording release acceptance, the accountable owners must review the inventory, the third-party dependencies, and LP-03's recipient/notice/handling decision. Resolve the GET-query exposure with them. A separately reviewed change may replace or remove that handoff; this privacy implementation does not silently change the established journey.

A fresh browser profile must inspect requests, cookies, local/session storage and IndexedDB before and after page load, every CTA, typed preview and form handoff using synthetic values. Record browser version, exact source revision/artifact hashes, CDN/transitive requests, any host/destination storage, offline and blocked-CDN behavior, and the difference between local preview and destination submission. Do not call asset requests tracking without evidence, and do not omit actual third-party tracking if discovered. Sensitive real input must not enter saved evidence. **These browser checks have not been performed here.**

Optional `review/privacy-approval.json` is consumed only after real evidence exists. No approval file is shipped. Its schema is `ticketstub.privacy-approval/1` and requires:

- `sourceRevision`: full 40-character commit SHA; `pageSha256` and `artifactFiles`: the exact built page digest and complete manifest file records.
- `approvals`: one `APPROVED` record for each accountable role, with named GitHub `reviewer`, the same `sourceRevision`, and a repository PR `reviewUrl` ending in `#pullrequestreview-ID`.
- `cleanBrowser`: `browserVersion`, `profile: "fresh"`, `testedAt`, the same source pin, an immutable repository `evidenceUrl`, `trackingRequests: 0`, `trackingStorageWrites: 0`, and scenarios `load`, `all-ctas`, `offline`, `blocked-cdn`, `form-handoff`.
- `lp03HandoffReviewed: true`, supported by the owner-reviewed evidence rather than assumed from a working URL.

Release validates the schema, resolves every `site/` file from the pinned local Git commit and compares its hash, resolves the pinned nonempty browser evidence file, and reads the actual GitHub reviews through `gh api`. Each review must be `APPROVED`, match the named reviewer and source SHA, and explicitly include `LP-07 privacy approval: ROLE` for its accountable role. This requires Git history and read access; missing or inaccessible evidence fails closed. The schema test's synthetic receipt is never used for release. Human review remains responsible for reviewer authority and whether the browser evidence actually supports the zero-tracking claims; strings and API metadata cannot establish that alone.

## Future collection boundary

Enabling analytics is separate owner-approved implementation work, with a versioned event/property allowlist, notice/consent decision, destination configuration, kill switch and reviewed retention/deletion/access ownership. Minimal event properties may identify a stable page/CTA and an outcome category. Exclude names, emails, ticket/barcode content, order/account IDs, credentials, form values, complete URLs, queries/referrers, fingerprinting and session replay. Confirmed downstream outcomes need application evidence; interest must stay distinct in any public reporting.

If that future work is approved, test synthetic payloads with a local collector, disabled/declined collection and failed/blocked destinations before enabling a provider. Off or failed collection must leave content, navigation, preview and handoff usable. No backfill, paid service, provisioning or provider activation is authorized by this record.

LP-07.A/C/D have partial local implementation evidence; owner/browser evidence remains pending. LP-07.B is conditional and deferred. No LP/master acceptance ID is marked complete.
