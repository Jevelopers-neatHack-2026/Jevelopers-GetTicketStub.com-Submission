# LP-03: local preview and link-only studio contract

Source base for activation: `01d9b08` (PR records full base/head); actual homepage `/`, following [site-map.md](site-map.md). Product and frontend owns this landing boundary. Receiving application owner under GT-10B #19 owns the supported studio destination, mode and assembled-host reachability. The Product owner orchestrator explicitly approved public navigation to `https://getticketstub.com/make` with label `Open studio`, public guest access, no customer input/query and known live mode. [cta-navigation-decision.json](../review/cta-navigation-decision.json) records the actual owner-thread decision as relayed, without inventing an immutable GitHub approval or deployed revision. Historical Airo remains withdrawn. This limited decision does not approve sandbox/physical ordering, artifact identity, landing publication or LP-12 release acceptance.

## Placements and available/unavailable behavior

| CTA ID | Placement | Actual action | State |
|---|---|---|---|
| LP-CTA-NAV | Header `Make yours` | Native `#make` anchor; existing local scroll/focus enhancement | Available local preview |
| LP-CTA-HERO | Hero primary button | Same `#make` | Available local preview |
| LP-CTA-FOOT | Footer primary/repeated link | Same `#make` | Available local preview |
| LP-CTA-EDIT | Maker `Update preview` / Enter | Parses details into local illustrative card; never submits/navigates | Available with page JS; no-JS cannot send input |
| LP-CTA-EXAMPLES | Three fictional example chips | Update the same local specimen/editor | Available local preview |
| LP-CTA-STUDIO | Separate `Open studio` link | Exact `https://getticketstub.com/make`, no copied input/query/fragment | Available public navigation only under current preview config |

`src/content/cta.json` is the reviewed static configuration, mirrored byte-for-data in `CTA_CONFIG` inside actual page code and checked by the suite. The explicit current environment is `preview`, with the approved exact origin/path and limited owner-thread navigation receipt. `demo`, `staging` and `production` retain `PENDING` destinations and unknown availability. The URL is supplied by the current owner decision, not inferred from brand identity, a health endpoint or an old link. Thread navigation approval cannot migrate to another environment.

An enabled entry needs `APPROVED`, `availability: verified`, an accountable `ownerRole`, an exact HTTPS `url`, `allowedOrigin`, `allowedPath`, empty `queryKeys`, and either the actual limited owner-thread navigation receipt or a separately reviewed immutable receiving-repo receipt. The navigation receipt records source thread `01a12764-1eaa`, relay time `2026-10-12T10:17:35Z`, owner decision time `UNKNOWN`, reported 10:14Z `/make` HTTP 200/health live/storage configured, and Landing read-only GET at 10:17:08Z returning 200 with no redirects. Deployed revision is `UNKNOWN`; no source SHA or release attestation is inferred. Runtime checks fail closed for malformed/missing data, nonmatching receipts, unsafe/private URLs and unknown environment/capture mode. Approval-shaped test data are synthetic fixtures only. Strings cannot establish broader owner authority, exact deployed artifact identity or release acceptance. This activation rests only on the actual Product owner relay and read-only public navigation observation; independent review of the exact candidate remains required. The shared release suite cannot pass this draft through an approved-shaped fixture. Invalid-config VM tests begin with the actual static active href and must remove it; a deletion mutant proves that safety assertion fails when withdrawal is missing.

Redirect/query allowlist is empty: no redirect parameter, tracking query, fragment, authentication token, ticket field or account detail crosses the boundary. Native studio navigation uses `target=_blank`, `rel="noopener noreferrer"`; page code does not programmatically open tabs, read destination state or claim success. The observed approved URL had no redirect on the recorded public GET; intended guest navigation is owner-approved. Future redirect or destination changes require renewed review. There is no automatically-followed redirect check or background availability request. An already-approved service may later become unavailable; visible copy warns availability can change. The receiving browser/server owns any resulting error page. No signup, persistence, design approval, purchase or fulfillment is inferred from a click.

The maker is a local `role=group` div, not a form. Input has no `name`; button has `type=button`; Enter prevents default and updates preview. Existing live editing, fictional chips, art and scroll remain. The former native external GET form, input-to-query fallback and false `Sent to the studio` feedback were removed. Empty/update feedback uses the existing polite live region, now visible on mobile. Studio status remains visible on mobile after typing. The approved link is a native static anchor, with the same exact URL before and after editing and without JS. There is still no action/native submit or input transmission; dynamic editing and existing maker/loader visibility depend on JS. Missing/invalid/unavailable runtime config removes the href and hides the studio link; reviewed static source must agree with valid config or the suite fails. The visible `role=status` paragraph does not claim send/success.

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

Draft CTA checks actual source/built config, real local editor and in-page handlers, ledger/hash and privacy audit; ten CTA tests cover missing/invalid environment/config, four enabled fixture environments, unavailable/missing/nonimmutable/mismatched receipt, scheme/host/path/credential/query/fragment/private route rejection, pointer/Enter/input/chips and no-JS markup. Synthetic inputs never go to a real receiver. Updated privacy tests trap collection, logging, persistence and programmatic navigation, even swallowed attempts. The actual limited thread receipt is distinct from synthetic fixtures. Local tests make no live navigation request and claim no deployed artifact identity.

Expected release result remains failure: deployed revision/artifact identity, broader acceptance and browser evidence are pending. The owner navigation decision cannot satisfy release. Clean-browser desktop/mobile/keyboard/reduced-motion checks and configured/unavailable screenshots are separately required; VM fixtures do not certify browsers, CDN execution, network or an external destination. Final broader LP-03.A/C assembled-host evidence still awaits GT-10B #19; LP-03.B/D have bounded local safety evidence. No LP/master criterion or issue is closed by this partial draft.
