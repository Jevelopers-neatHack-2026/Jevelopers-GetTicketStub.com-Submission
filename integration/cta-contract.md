# LP-03: local preview and link-only studio contract

Source base: `b6ae55c` (PR records full base/head); actual homepage `/`, following [site-map.md](site-map.md). Product and frontend owns this landing boundary. Receiving application owner under GT-10B #19 owns the supported studio destination, mode and assembled-host reachability. No current owner-confirmed destination receipt exists here. Historical Airo URL and historical `/make` are not approvals and are not activated. This bounded safety implementation leaves LP-03.A and final destination/browser acceptance pending.

## Placements and available/unavailable behavior

| CTA ID | Placement | Actual action | State |
|---|---|---|---|
| LP-CTA-NAV | Header `Make yours` | Native `#make` anchor; existing local scroll/focus enhancement | Available local preview |
| LP-CTA-HERO | Hero primary button | Same `#make` | Available local preview |
| LP-CTA-FOOT | Footer primary/repeated link | Same `#make` | Available local preview |
| LP-CTA-EDIT | Maker `Update preview` / Enter | Parses details into local illustrative card; never submits/navigates | Available with page JS; no-JS cannot send input |
| LP-CTA-EXAMPLES | Three fictional example chips | Update the same local specimen/editor | Available local preview |
| LP-CTA-STUDIO | Separate `Open demo studio` link | Exact approved URL only, no copied input, query or fragment | Hidden/no href until valid approved environment configuration |

`src/content/cta.json` is the reviewed static configuration, mirrored byte-for-data in `CTA_CONFIG` inside actual page code and checked by the suite. Current environments `preview`, `demo`, `staging`, `production` all have `PENDING` destinations, null URL/origin/path and unknown availability. The explicit current environment is `preview`. There is no host/domain/route inferred from brand identity, the deployed health endpoint or a historical link.

An enabled entry needs `APPROVED`, `availability: verified`, an accountable `ownerRole`, an exact HTTPS `url`, `allowedOrigin`, `allowedPath`, empty `queryKeys`, and a receipt with named reviewer, review date, full source revision, immutable receiving-repo evidence URL, exact destination and environment. Runtime checks fail closed for malformed/missing data, nonmatching receipts, unsafe/private URLs and unknown environment/capture mode. Approval-shaped test data are synthetic fixtures only. Strings cannot establish owner authority or live reachability: a real receipt plus independent review and exact-host/browser evidence are required before activation. The shared release suite cannot pass this draft through an approved-shaped fixture.

Redirect/query allowlist is empty: no redirect parameter, tracking query, fragment, authentication token, ticket field or account detail crosses the boundary. Native studio navigation uses `target=_blank`, `rel="noopener noreferrer"`; page code does not programmatically open tabs, read destination state or claim success. The owner must provide final redirect inventory and intended experience evidence before enabling a URL. There is no automatically-followed redirect check or background availability request. An already-approved service may later become unavailable; visible copy warns availability can change. The receiving browser/server owns any resulting error page. No signup, persistence, design approval, purchase or fulfillment is inferred from a click.

The maker is a local `role=group` div, not a form. Input has no `name`; button has `type=button`; Enter prevents default and updates preview. Existing live editing, fictional chips, art and scroll remain. The former native external GET form, input-to-query fallback and false `Sent to the studio` feedback were removed. Empty/update feedback uses the existing polite live region, now visible on mobile. Pending destination reason remains visible on mobile after typing. Without JS there is no external href/action/native submit or input transmission; dynamic preview editing needs JS. The destination reason is a visible `role=status` paragraph.

## Capture decisions

Waitlist, signup, contact, request-demo and early-access collection are **deferred**. No receiver, retention/deletion policy, credentials, persistence endpoint or collection success state is introduced. Local specimen editing is not a capture form. Public event URLs are parsed locally as text; no research, fetch or verification occurs. Future collection requires separately approved receiver/data owner, notice, fields, transport, retention/deletion and abuse handling before implementation. [analytics-decision.md](analytics-decision.md) records CDN/host and privacy limits; this change does not certify third-party code or hosting logs.

## Executable evidence and remaining acceptance

Pinned Node: 24.15.0; no package install or provider call. Commands actually run are recorded with exact source SHA in the PR:

```sh
./scripts/validate-landing --suite cta --mode draft
./scripts/validate-landing --suite cta
node --test tests/cta.test.mjs tests/privacy.test.mjs
./scripts/validate-landing --suite privacy --mode draft
./scripts/validate-landing --suite content --mode draft
./scripts/validate-landing --suite proof --mode draft
./scripts/validate-landing --suite metadata --mode draft
./scripts/validate-landing --suite foundation
node --test tests/scroll.test.mjs tests/content-proof.test.mjs
```

Draft CTA checks actual source/built config, real local editor and in-page handlers, ledger/hash and privacy audit; seven CTA tests cover missing/invalid environment/config, four enabled fixture environments, unavailable/missing/nonimmutable/mismatched receipt, scheme/host/path/credential/query/fragment/private route rejection, pointer/Enter/input/chips and no-JS markup. Synthetic inputs never go to a real receiver. Updated privacy tests trap collection, logging, persistence and programmatic navigation, even swallowed attempts. No fabricated owner receipt or live reachability is supplied.

Expected release result is failure while the real destination, receipt, exact-host and browser evidence are pending. Clean-browser desktop/mobile/keyboard/reduced-motion checks and configured/unavailable screenshots are separately required; VM fixtures do not certify browsers, CDN execution, network or an external destination. Final LP-03.A/C evidence awaits GT-10B #19; LP-03.B/D have bounded local safety evidence. No LP/master criterion or issue is closed by this partial draft.
