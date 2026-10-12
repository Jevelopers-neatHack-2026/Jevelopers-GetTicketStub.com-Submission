# Current local metadata/privacy/CTA boundary evidence

Captured 2026-10-12T11:47:40Z against exact main source **`54dce1810a5e00d30580e614c8244f9b4ca67c15`**. Node **v24.15.0**, matching `.nvmrc` 24.15.0; Darwin/arm64; shell `/bin/zsh -lc`. This evidence supports LP-07 #9, LP-08 #10 and LP-10 #12 locally; it changes no source/config/validator or central acceptance status.

[Machine-readable record](current-local-evidence.json) pins the complete artifact inventory, every checked script/test/config/ledger, execution times, exact exit codes, and unedited combined output byte lengths/SHA-256. Logs are included for reproducibility and review; they contain local paths and synthetic test labels, no credentials/customer input.

Artifact `ticketstub.landing-artifact/1`: 11 payload files, all SHA-256 checked and byte-identical to `site/` at the recorded source. Manifest SHA-256: `e64d9bcaf5b26f0a1bc1d104e679a5f26a2f4fda30cde023dba506692bdc06ad`. Page SHA-256: `9c3b80588cfa0e4c226e04102f0b14e6bb820fb0d88c61b2965bdd8f01038159`. `dist/` remains ignored; the exact manifest records are retained in the JSON. The evidence commit adds documentation only; the tested source commit is the immutable main base above.

## Executed commands

| Command | Actual exit | Actual outcome | Exact log |
|---|---|---|---|
| `node scripts/build.mjs` | `0` | 11 byte-identical payload files built | [build.log](logs/build.log) |
| `node --test tests/*.test.mjs` | `0` | 104 tests passed; no failures/skips | [all-tests.log](logs/all-tests.log) |
| `./scripts/validate-landing --suite metadata --mode draft` | `0` | PASS_DRAFT | [metadata-draft.log](logs/metadata-draft.log) |
| `./scripts/validate-landing --suite privacy --mode draft` | `0` | PASS_DRAFT | [privacy-draft.log](logs/privacy-draft.log) |
| `./scripts/validate-landing --suite cta --mode draft` | `0` | PASS_DRAFT | [cta-draft.log](logs/cta-draft.log) |
| `./scripts/validate-landing --suite metadata` | `1` | FAIL metadata: Production origin pending: app/hosting owner must supply it | [metadata-release.log](logs/metadata-release.log) |
| `./scripts/validate-landing --suite privacy` | `1` | FAIL privacy: Privacy release approval receipt missing: owner review, LP-03 handoff and clean-browser evidence pending | [privacy-release.log](logs/privacy-release.log) |
| `./scripts/validate-landing --suite cta` | `1` | FAIL cta: Release CTA deployed revision/artifact identity, broader owner acceptance and browser evidence pending; navigation-only approval cannot pass release | [cta-release.log](logs/cta-release.log) |

All expected exit codes matched. **The three release gates executed and failed.** Their expected failures demonstrate that pending prerequisites remain enforced; they do not establish release acceptance. No required skipped check is counted as a pass.

## What the local checks establish

The 104 Node tests exercise existing source/tests with deterministic synthetic cases and loopback HTTP where implemented. Metadata draft checks the actual static source/artifact head, preview `noindex,nofollow`, omitted canonical/social image/structured data, and negative environment/origin/private-route fixtures. Privacy draft checks pinned markup/style/executable bytes, allowed resource destinations and limited VM editor/navigation behavior. CTA draft checks the exact owner-approved public link and input-isolation/config-withdrawal fixtures. No external receiver, credential or provider call is used; the privacy release check stops at its absent real approval receipt.

These results do **not** establish a fresh-browser network/storage audit, CDN/transitive execution certification, social image dimensions/alt/render, an external social-card renderer, crawler/indexing behavior, deployed artifact identity, asset publication rights or public landing release approval. No browser screenshot or prior observation is relabeled as a current clean-browser attestation.

## Existing navigation decision and unresolved gates

The unchanged [Product-thread navigation decision](../cta-navigation-decision.json) approves label **Open studio**, exact **`https://getticketstub.com/make`**, public guest navigation, no query/customer data, and records known **live** mode. Source thread: `01a12764-1eaa`; owner decision time: **UNKNOWN**; relay: `2026-10-12T10:17:35Z`. Its prior 10:14Z health/live/storage observation and 10:17:08Z no-redirect GET are preserved as historical relayed observations, **not refreshed by this local run**. Deployed revision remains **UNKNOWN**. Navigation approval does not approve sandbox/physical orders, deployed source/artifact identity, marketing/assets, publication or LP-12 acceptance.

Metadata release remains blocked on owner-confirmed production origin/indexing and other approval/integration requirements. Privacy release remains blocked on accountable owner review and actual clean-browser evidence. CTA release remains blocked on deployed identity, broader acceptance and browser evidence. Social image/rights and marketing/asset publication approvals remain pending. No issue or LP/EVAL criterion is closed; authoritative release acceptance stays with its owners.
