# Analytics deferred; local preview and link-only demo boundary (LP-07)

Recorded 2026-10-12; LP-03 safety update against landing base `b6ae55c` withdraws the former external GET handoff. The later activation from base `01d9b08` uses an actual Product owner navigation-only decision; see [cta-contract.md](cta-contract.md) and [cta-navigation-decision.json](../review/cta-navigation-decision.json). Privacy/publication approval remains pending. This is a draft implementation decision for [LP-07 #9](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/9). Product and frontend owns purpose and the landing experience; Finance and reliability owns the privacy/data review. Named accountable owners and their approvals are **pending**. LP-03 #5 must establish the receiving application URL and handling behavior before release. This record does not close #9 or change EVAL-03/EVAL-04 acceptance.

Public analytics and telemetry are **deferred**. There is no provider, event collector, event schema, cookie, consent toggle, tracking dashboard or paid integration in this implementation. The measurement questions, if collection is later deliberately approved, are whether visitors reach an appropriate demo entry and whether the downstream application reports a confirmed outcome. A landing CTA expresses interest only. A click, preview update, external handoff, fallback link or tab losing focus proves no signup, purchase, printed object or delivery.

The current page has no landing-authored input collection or submitting form. It is **not a no-network baseline**: host/CDN requests below remain. Local preview editing and any future approved link are distinct from third-party execution, which still needs browser evidence.

| Flow | Current behavior and recipient | Boundary / unresolved review |
|---|---|---|
| Page and art | Host serves HTML, eight WebP scene images, `assets/flight.json`, and `assets/ticketstub.gltf.json`. The model's buffer is embedded as a data URI. | Hosting/access logs, retention and deletion belong to the eventual host; not inspected here. |
| Fonts | Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`; Google Fonts CSS names Archivo, Big Shoulders Display, IBM Plex Mono, Abril Fatface, Fraunces and Inter Tight, then the browser can fetch font files. | Network identifiers, user agent and browser-dependent request/referrer information reach Google. Exact response-selected font URLs/storage behavior need clean-browser evidence. |
| Animation libraries | jsDelivr loads Motion `11.11.17` and Three.js `0.160.0`; import map permits Three addons, including GLTFLoader and RoomEnvironment and their transitive imports. | Versioned URLs are not content integrity pins. Executed CDN code and transitive requests/storage were not certified by a VM/source scan. |
| Typed or fictional example details | Real maker handlers parse text into an illustrative card in memory. No landing-authored network call or persistence is made by these handlers in the local harness. | This does not inspect CDN code or browser extensions. Test fixtures contain synthetic data only. |
| Local update / studio continuation | Local nameless editor group and `type=button` control; Enter updates locally. Separate `Open studio` anchor navigates only to the owner-approved `https://getticketstub.com/make`, without entered text, query or fragment. Current known mode is live/public guest, not a sandbox journey. Missing/invalid configuration still disables the link. | The former native GET and text-query fallback are withdrawn. The actual owner thread decision and read-only 200/no-redirect observation authorize navigation only. Deployed revision is UNKNOWN; privacy, public release and physical-order/sandbox acceptance are not approved by that decision. No external demo request was made during validation. |
| Local diagnostics | Two existing `console.warn` calls report animation initialization/frame errors; they are retained and exactly covered by the executable audit. | These are not remote telemetry. Browser/library error objects may contain technical asset details; any added input logging or warning change requires review. |

`review/privacy-inventory.json` pins the existing executable script blocks, stylesheet bytes and markup tags, resource link URLs, import map, external Motion script and current link-only studio boundary. CTA changes refresh author audit hashes with status still `PENDING`, never owner approval. It is an author audit marked `PENDING`, not approval. Metadata canonical/social URLs and JSON-LD are declarations, not tracking requests, and do not change executable hashes; meta refresh/header behavior is rejected. The build manifest separately checks every public file against source bytes. This conservative baseline audit is not a general HTML/JavaScript security parser or an exhaustive runtime privacy audit.

For LP-PIN-1 R1, the current `auditedSourceRevision` is the immutable local commit `329fc4f27e7b9792e60eabcf4f2401f4541254a5`, with complete-page `pageSha256` `a078774df18e59b884bdff968f2bec3e4a5b2a009458d30c8320242f595858f6`. Draft and release resolve that commit's page from local Git objects, require both current and pinned page bytes to match the digest, then apply the inventory's structural/executable privacy checks to the pinned source. `historicalSourceReferences` retains the valid PR #29 header audit at `096fe76`, which resolves to the same current page bytes, and the earlier `01d9b08` base, whose executable bytes do not match the current inventory. The header CSS digest and audit note are preserved. Missing local history, moving or unavailable revisions and mismatched bytes fail closed; no Git fetch is performed. Metadata-only changes also require refreshing the complete-page audit pin. This local source binding grants no privacy/browser/publication approval and leaves the navigation-only decision intact.

## Executable local checks

Use the repository's pinned Node version (`.nvmrc`: 24.15.0); no package install, provider or collector is needed:

```sh
node --test tests/privacy.test.mjs
./scripts/validate-landing --suite privacy --mode draft
./scripts/validate-landing --suite privacy
```

The first two commands validate the draft boundary. The third defaults to release and **fails** while the real approval receipt and browser evidence are absent. A missing required check is not a pass. The suite validates built bytes, rejects unreviewed SDK/resource destinations, collection controls, inline handlers, executable URLs, CSS requests, logging and storage/beacon APIs. Pinned scripts/styles catch computed API changes and local tracking URLs that a token scan alone can miss. Conservative restrictions require re-audit when public code or resource surfaces change.

The VM harness executes the real maker and all existing in-page link handlers with collection/network/storage/logging surfaces throwing blocked/failure errors, with reduced motion on and off. It exercises empty/update clicks and Enter, fictional example chips, typed preview updates, CTA focus/navigation and approved public link plus disabled/link-only fixture behavior. Its stubs record attempted forbidden operations even if page code swallows the error; seeded tests prove these traps fail. There is no imaginary enabled collector or declined-consent implementation: collection has no enabled path and no consent UI to test. No-collection source behavior and continued navigation are local findings, not browser attestations. Existing scroll tests cover animation fallback separately.

## Required release evidence

Before recording release acceptance, the accountable owners must review the inventory, the third-party dependencies, and LP-03's link-only destination/mode/redirect decision. The CTA change removed the prior GET-query exposure; independent source/browser review is still required before release.

A fresh browser profile must inspect requests, cookies, local/session storage and IndexedDB before and after page load, every CTA, typed preview and the link-only demo boundary using synthetic values. Record browser version, exact source revision/artifact hashes, CDN/transitive requests, any host/destination storage, offline and blocked-CDN behavior, and the difference between local preview and destination navigation. Do not call asset requests tracking without evidence, and do not omit actual third-party tracking if discovered. Sensitive real input must not enter saved evidence. **These browser checks have not been performed here.**

Optional `review/privacy-approval.json` is consumed only after real evidence exists. No approval file is shipped. Its schema is `ticketstub.privacy-approval/1` and requires:

- `sourceRevision`: full 40-character commit SHA; `pageSha256` and `artifactFiles`: the exact built page digest and complete manifest file records.
- `approvals`: one `APPROVED` record for each accountable role, with named GitHub `reviewer`, the same `sourceRevision`, and a repository PR `reviewUrl` ending in `#pullrequestreview-ID`.
- `cleanBrowser`: `browserVersion`, `profile: "fresh"`, `testedAt`, the same source pin, an immutable repository `evidenceUrl`, `trackingRequests: 0`, `trackingStorageWrites: 0`, and scenarios `load`, `all-ctas`, `offline`, `blocked-cdn`, `local-preview`, `link-only-demo`.
- `lp03HandoffReviewed: true`, supported by the owner-reviewed evidence rather than assumed from a working URL.

Release validates the schema, resolves every `site/` file from the pinned local Git commit and compares its hash, resolves the pinned nonempty browser evidence file, and reads the actual GitHub reviews through `gh api`. Each review must be `APPROVED`, match the named reviewer and source SHA, and explicitly include `LP-07 privacy approval: ROLE` for its accountable role. This requires Git history and read access; missing or inaccessible evidence fails closed. The schema test's synthetic receipt is never used for release. Human review remains responsible for reviewer authority and whether the browser evidence actually supports the zero-tracking claims; strings and API metadata cannot establish that alone.

## Future collection boundary

Enabling analytics is separate owner-approved implementation work, with a versioned event/property allowlist, notice/consent decision, destination configuration, kill switch and reviewed retention/deletion/access ownership. Minimal event properties may identify a stable page/CTA and an outcome category. Exclude names, emails, ticket/barcode content, order/account IDs, credentials, form values, complete URLs, queries/referrers, fingerprinting and session replay. Confirmed downstream outcomes need application evidence; interest must stay distinct in any public reporting.

If that future work is approved, test synthetic payloads with a local collector, disabled/declined collection and failed/blocked destinations before enabling a provider. Off or failed collection must leave content, navigation, preview and handoff usable. No backfill, paid service, provisioning or provider activation is authorized by this record.

LP-07.A/C/D have partial local implementation evidence; owner/browser evidence remains pending. LP-07.B is conditional and deferred. No LP/master acceptance ID is marked complete.
