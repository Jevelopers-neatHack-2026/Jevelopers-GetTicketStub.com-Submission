# TicketStub identity decision packet

**Status: proposal. Every brand, rights, consumer and release decision is pending.** This packet makes the existing source baseline and PR #3 alternatives reviewable; it is not an approval register. Refs [BK-02 #9](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/9), [BK-01 #6](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/6), [BK-07 #8](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/8) and [BK-05 #13](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/13).

- **Decision ID:** `BK-02-baseline-2026-10-12-proposal`
- **Status:** proposal
- **Change class:** core identity, with a separate documentation-only reconciliation
- **Proposed by / date:** brand-kit execution agent / 2026-10-12
- **Superseded by / supersedes:** none; the existing A+B baseline remains in force pending an actual decision
- **Reinstates:** none

## Change and exact diff

- **Base revision:** `3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4`, the merged PR #22 baseline.
- **Proposed revision:** that same immutable baseline for source review. This packet's claim labels and navigation corrections clarify its status; they do not ratify a changed identity.
- **Alternative revision:** PR #3 head `289b22659f0699649abd65ba7a3b7e710839f4d3`, based on `74bc86fe5b520cae792066fbe0d7dd129664bbd3`.
- **Diff:** [PR #3 original proposal](https://github.com/Jevelopers-neatHack-2026/brand-kit/compare/74bc86fe5b520cae792066fbe0d7dd129664bbd3...289b22659f0699649abd65ba7a3b7e710839f4d3); [merged PR #22 link-only diff](https://github.com/Jevelopers-neatHack-2026/brand-kit/commit/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4).

The hash manifest below freezes the inspected baseline, including its unratified rules and reference material. It cannot approve later source edits. An eventual decision must identify the final reviewed revision and fresh hashes for every changed file, and explicitly exclude unsupported capability/price copy and reference artwork. Do not reuse this baseline's hashes as approval of a later integration candidate.

## Baseline decisions requested

| Acceptance | Existing source and rationale | Concrete decision required | Disposition and accountable review |
|---|---|---|---|
| BK-02.1 — master direction | [SPEC](../SPEC.md#design-directions): A. Paper Desk for the base and B. Night Stage for signature moments; C. Box Office rejected as master because it resembles transactional ticketing, retained as a Classic-edition reference. | Ratify A+B, approve an amended paper-only app scope, or explicitly defer. Preserve C's rejected-master rationale in every case. | **Pending.** @CompleteDotTech, provenance and affected consumer reviewers. The existing recommendation is not dated approval evidence. |
| BK-02.2 — mark hierarchy | [Fourteen canonical SVGs](#files-and-hashes), generated from Fraunces by [build_logos.py](../tools/build_logos.py); [logo rules](logo.md). | Confirm primary `ts-stamp.svg`, secondary wordmarks/lockups, mono/currentColor, favicon and app-icon uses in the variant table below. Accept or exclude each listed variant. | **Pending.** No sponsor, organizer or customer co-brand arrangement is implied. |
| BK-02.3 — palette and themes | [Six token values](../tokens/tokens.json) and [SPEC roles](../SPEC.md#colour); cream/ink day, ink/moss night; 135° copper → orange → cyan brand foil. | Ratify those exact values and scopes; decide A+B versus the paper-only app amendment separately from whether dark marketing/print treatments remain permitted. Review the flake-film and sound proposals separately. | **Pending.** Accessibility restrictions remain subject to [BK-08](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/12); no color is changed here. |
| BK-02.4 — typography | Fraunces display/logo and Inter Tight UI/body; [type settings](../SPEC.md#typography), [token profile](token-profile.md), bundled OFL notices. | Confirm families, weights/axes, scale/fallbacks and tabular numerals; approve an exact external-hosted font delivery proposal with privacy/CSP/network/fallback evidence. | **Pending.** The recorded **no-self-hosted-font** constraint already applies. Existing TTF files remain source material, not runtime distribution assets. |
| BK-02.5 — imagery and voice | [Imagery](imagery.md) and [voice](voice.md); [claim register](claims-register.md). SPEC separates master-brand UI from user artwork, while imagery currently says its generated-art restrictions apply to every generated layer. | State whether no text/one orange accent/face-and-crowd restrictions govern master collateral, selected brand examples, user artwork editions, or another exact scope; obtain creative-engine review before changing edition rules. Confirm voice principles while excluding unverified product claims. | **Pending.** No universal user-artwork restriction or blanket rights permission is ratified. Reference-only images remain excluded. |
| BK-02.6 — reusable UI icons | [Current inventory](source-of-truth.md#iconography): favicon/app-icon are logo variants; the board's inline mute glyph is a demo illustration. No owned UI icon family exists. | Choose consumer-owned UI icons with an explicit handoff, or approve a later source/style proposal. Name the source and owner of any new icon family before adoption. | **Pending.** No icon library is selected and no consumer icon implementation is replaced. |

### Mark and lockup dispositions

Every row is **candidate / approval pending**. Existing combinations are shown for review, not newly permitted by this table.

| Canonical file | Existing intended use | Review question |
|---|---|---|
| [ts-stamp.svg](../logo/ts-stamp.svg) | Primary foil stamp on flat cream/ink; app/social/stub back | Confirm primary symbol and the exact master-versus-artwork placement scope. |
| [ts-stamp-mono-ink.svg](../logo/ts-stamp-mono-ink.svg) | One-color stamp; light plate, print/foil/emboss source | Confirm permissible print contexts and process validation. |
| [ts-stamp-mono-orange.svg](../logo/ts-stamp-mono-orange.svg) | One-color orange stamp | Confirm permitted flat backgrounds and minimum size. |
| [ts-stamp-mono-cream.svg](../logo/ts-stamp-mono-cream.svg) | Inverted stamp on ink/dark plate | Confirm dark marketing/print scope separately from app direction. |
| [ts-stamp-currentcolor.svg](../logo/ts-stamp-currentcolor.svg) | Consumer-controlled single-color code source | Confirm allowed colors; the consumer must verify its embedding method. |
| [favicon.svg](../logo/favicon.svg) | Square symbol for 16–32 px contexts | Confirm small-size substitution and consumer exports. |
| [app-icon.svg](../logo/app-icon.svg) | 1024 px app-icon source, foil on Night Ink | Confirm app-icon purpose; platform raster/export acceptance remains BK-04. |
| [wordmark.svg](../logo/wordmark.svg) | Primary perforated wordmark at 120 px wide or above | Confirm wordmark hierarchy and background. |
| [wordmark-orange.svg](../logo/wordmark-orange.svg) | Orange wordmark variant | Explicitly retain or exclude; its presence is not permission for every background. |
| [wordmark-cream.svg](../logo/wordmark-cream.svg) | Cream wordmark on dark backgrounds | Confirm permitted dark contexts. |
| [wordmark-compact.svg](../logo/wordmark-compact.svg) | Wordmark without tear dots below 120 px | Confirm compact substitution; no new minimum width is invented. |
| [lockup-horizontal.svg](../logo/lockup-horizontal.svg) | Stamp plus primary wordmark | Confirm horizontal combination and clear-space measurement. |
| [lockup-horizontal-mono.svg](../logo/lockup-horizontal-mono.svg) | Single-color horizontal combination | Confirm one-color use and background. |
| [lockup-stacked.svg](../logo/lockup-stacked.svg) | Stamp above wordmark | Confirm stacked combination for packaging/vertical space. |

### Palette and typography to confirm

| Element | Exact baseline | Review boundary |
|---|---|---|
| Ticket Orange | `#E4572E` | CTA fill/stamp accent; use ink CTA labels; no normal orange body text on cream. |
| Copper | `#B4693E` | Foil/premium design accent; cream and ink text pairings both require large-text restrictions. |
| Stage Moss | `#26302A` | Existing night raised surface; app usage is the pending PR #3 decision. |
| Holo Cyan | `#7CC6D2` | Existing dark-surface focus/foil accent; not normal text on cream or a direct focus boundary on orange. |
| Stub Cream | `#F4ECDD` | Paper/day surface and dark-surface text. |
| Night Ink | `#17140F` | Body text/day and dark ground/night. |
| Fraunces logo | `opsz 144`, `wght 600`, `SOFT 0`, `WONK 0` | Generator input and outlined SVGs; not a new runtime font grant. |
| Fraunces display | `wght 560`, `SOFT 30`, `tracking -0.02em` | Board explicitly uses optical size in examples; final font-delivery/axis parity needs BK-03B review. |
| Inter Tight | `400` body, `500` labels, `600` buttons; tabular numerals for dates/seats/prices | Dense-data readability requires actual zoom/narrow-width/fallback evidence. |
| Scale and fallback | Major third from 16 px; Fraunces → Iowan Old Style/Palatino Linotype/Georgia/serif; Inter Tight → Segoe UI/system-ui/-apple-system/sans-serif | External font unavailable mode must remain legible. No local TTF distribution is authorized. |

The [accessibility matrix](accessibility/contrast-report.md) owns calculated pair restrictions. These restrictions qualify how existing colors may be used; they do not approve a new palette or establish whole-product accessibility.

## PR 3 reconciliation

Refresh observed on 2026-10-12: main `3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4`; PR #3 head `289b22659f0699649abd65ba7a3b7e710839f4d3`; merge base `74bc86fe5b520cae792066fbe0d7dd129664bbd3`. Main has seven unique commits and the proposal five. GitHub reports PR #3 open, non-draft and conflicting. Its author/branch owner is @lmvdz; @CompleteDotTech is requested for review. No submitted GitHub review, review thread, commit status or PR workflow run was returned at refresh. A conversation [request-changes review](https://github.com/Jevelopers-neatHack-2026/brand-kit/pull/3#issuecomment-6117604850) and the [latest hold receipt](https://github.com/Jevelopers-neatHack-2026/brand-kit/pull/3#issuecomment-6122164575) remain controlling evidence of unresolved work.

| File / original hunk | Disposition | Exact integration or decision boundary |
|---|---|---|
| `README.md` related-repositories addition | Rule-neutral link is valid; PR #22 already updated front-door status but did not add this paragraph's edition link. | This follow-up adds the source link pinned to Product `43bb721f00de1c616e8e8d27efbb87c6bf75bcbf`, retaining the ownership split and source-only evidence scope. |
| `SPEC.md` two-tiers link | Already integrated, with a stronger immutable pin, by PR #22. | Keep the pinned link. A raw merge conflicts because PR #3 uses mutable `main`. |
| `docs/material-foil.md` engineering-source link | Already integrated, with a stronger immutable pin, by PR #22. | Keep the pinned link. Do not replace it with PR #3's mutable `main`. |
| `tokens/tokens.json` root `$description` | Unique rule-neutral path correction remains valid. | Replace only `ticket-studio` with `getticketstub.com docs/studio/stub-system.md`; preserve the merged TicketStub profile / non-DTCG description and token validation. PR #3's whole-line version would regress that profile description. This follow-up integrates the description correction and refreshes exact generated/provenance hashes without changing any token value. |
| `SPEC.md` directions and moss/ink roles | Unique, **pending core decision**. | A-only, no dark app stage, and marketing/print retention require BK-02.1/.3 and affected consumer review. No such decision is recorded in the current issue comments. |
| `docs/material-foil.md` flake stock, screen/multiply values, rest/loop rules and light-first acceptance | Unique, **pending material/identity review**. | Do not infer global foil policy or a physical print upgrade from an app implementation. Review scope, rendering evidence, rights and accessibility with relevant owners. |
| `docs/motion-sound-haptics.md` paper-only sentence | Unique, **pending the same app-direction decision**. | Reconcile README, SPEC, board, token prose and motion guide together after a real decision. |
| `docs/motion-sound-haptics.md` synthesized Web Audio, printer ticks, seven cue rules and audition/source references | Unique, **pending sound/provenance/consumer review**. | These replace the existing sourced-cue/thermal-whirr policy. A code path and a claimed upstream MIT source alone do not approve the new rule or establish deployment/audio validation. |

**PR #3 is not fully superseded.** It must remain available for its author's unique proposal and a dated scoped decision. This packet neither closes it nor edits its branch. Actual source conflicts occur in SPEC, material-foil and the token description; later integration must preserve current generated token behavior and PR #22's immutable links. Other source changes introduced since PR #3's base must also remain intact.

The old missing-upstream-path blocker is cleared: getticketstub.com PRs [#4](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/4) and [#20](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/20) merged. PR #22's [exact-head review](https://github.com/Jevelopers-neatHack-2026/brand-kit/pull/22#issuecomment-6122144808) records successful reads of both pinned source paths and the earlier structural checks. This is source availability evidence; no deployed `/parts`, font delivery, consumer ACK or release acceptance is inferred.

## Files and hashes

The following manifest is computed from Git blob bytes at the fixed baseline revision above, not from the changing working tree. Each source link includes that revision. Every identity/source/output row is **unapproved**; `references/` rows are **excluded, rights unknown**. Font TTF rows are **source-only** under the no-self-hosting constraint. The register/allowlist and governance rows are context, not approval authority.

| Path | Immutable source | SHA-256 |
|---|---|---|
| `README.md` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/README.md) | `39d37729bc1a482b1d44f0462d1ff1841c6a8f144bcc374bf926d92c0e16760a` |
| `SPEC.md` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/SPEC.md) | `4ca7a4c8f8d6859c548f2c9bda939f801f5b8677aa732b1de4a34e12cf5bf9c3` |
| `docs/architecture/OWNERSHIP.md` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/docs/architecture/OWNERSHIP.md) | `1303f62e35ffca1129723df20f970392acfef627639effb5b4389b9a1178a7e4` |
| `docs/assets/readme/banner-day.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/docs/assets/readme/banner-day.svg) | `ca1e8bc7ed18e89f70aadccd737d10dfebd08091d0cca0b6d922ad414a3fcfae` |
| `docs/assets/readme/banner-night.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/docs/assets/readme/banner-night.svg) | `dbc5c1a5a36ea2aee7d5a2becc19e750432b5de97744d7a15b13a872e2d7a93c` |
| `docs/brand-governance.md` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/docs/brand-governance.md) | `65c8b124a6ab25c9dd7f55a6ffa924217f586d02fe3d9968dd8212c6fdcb9444` |
| `docs/imagery.md` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/docs/imagery.md) | `fc38a8ab086e0e69bccfc656ba8e3a444d325e56c60c5c83e3c83ea1ffe05a2c` |
| `docs/logo.md` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/docs/logo.md) | `04aa94912718e8424b03ae7d98d5c1cbc03e2bfb3c664de368e967cd034b3dc3` |
| `docs/material-foil.md` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/docs/material-foil.md) | `a2ea27c65f3d95840a73dbecf1f0dcbf18b685d491a69cc2217352199fc69fb1` |
| `docs/motion-sound-haptics.md` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/docs/motion-sound-haptics.md) | `ff3d5a48801af20e0a3799062511790b93d1edd11e38c99809b1ddc4fd8c5fc6` |
| `docs/token-profile.md` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/docs/token-profile.md) | `5569a3e20e546ef4cc41b257221ff661e4e75f625b1e0fe4726749bab114c6e0` |
| `docs/voice.md` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/docs/voice.md) | `6af9864b397a677c6d5af953f2afb85314868a91cd4dfe57bec4b013907b6027` |
| `fonts/Fraunces-OFL.txt` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/fonts/Fraunces-OFL.txt) | `bdf4c22802eaf804f998195871c6b8938aac2ac14b2d78a8bd66a6f1eced833b` |
| `fonts/Fraunces[SOFT,WONK,opsz,wght].ttf` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/fonts/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf) | `177ff6c0f14e5550a3c624247cd1189611d4eb65d000b14944c63d967958abbb` |
| `fonts/InterTight-OFL.txt` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/fonts/InterTight-OFL.txt) | `50240ab035cf1b6b3307940235481d515c4b6de3ab1fa843dbe59e7892cb9d58` |
| `fonts/InterTight[wght].ttf` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/fonts/InterTight%5Bwght%5D.ttf) | `b81b73dcb64df3c230cabade7df6c5773bf863233f24c9ee51087519f1f88b6f` |
| `index.html` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/index.html) | `13f5a53605fafd8252719b8fb6a126b794fe4cf8cb4859216338f135a4e490fb` |
| `inventory/brand-inventory.json` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/inventory/brand-inventory.json) | `482b3bba62a70a14689ca83917d64c3c7e011d200472405004b9d4e1541764e9` |
| `logo/app-icon.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/app-icon.svg) | `22129ff127d1c229d33206d5df48c36f7e3338cb697ac04fe97090448b77456e` |
| `logo/favicon.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/favicon.svg) | `ad9701d4ae6416c6a9d789c80b422ace7ab70cf1feac57adab4bbcc25d47d3b1` |
| `logo/lockup-horizontal-mono.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/lockup-horizontal-mono.svg) | `07c25323b72a10cf98b023b95c13fd3e51851405731b04b83f30eaf1d1b6cfe3` |
| `logo/lockup-horizontal.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/lockup-horizontal.svg) | `1f810daf26caebd3f661b30a4406dbea61d5cd294e6e887c0b994780d9b3750f` |
| `logo/lockup-stacked.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/lockup-stacked.svg) | `66a16141405d18cca1ea709c0a8a9d59f248b442e7fc27ffb4e655501741edb0` |
| `logo/ts-stamp-currentcolor.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/ts-stamp-currentcolor.svg) | `61007e1795eac0582f20f57bcdaf83eab5d8c9cadc054e824ce686cf1796a5a9` |
| `logo/ts-stamp-mono-cream.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/ts-stamp-mono-cream.svg) | `077f0b2936af1a842991d5922f5471067486447fb3e9c570b8510f2260f9dae5` |
| `logo/ts-stamp-mono-ink.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/ts-stamp-mono-ink.svg) | `2b3ec01e538a1ff55250965c324ac0e999234a9039b8dbbf8864c09430ea8bae` |
| `logo/ts-stamp-mono-orange.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/ts-stamp-mono-orange.svg) | `f00077dfb41815c3e26d8b32e4d572eff66834861433e301bb208108c21f07a8` |
| `logo/ts-stamp.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/ts-stamp.svg) | `a1279c701ff62a20288854bef1e7a7718128125d745485e30a019f2a2c78efd8` |
| `logo/wordmark-compact.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/wordmark-compact.svg) | `9c147c238f5734d0673760ca95c8ea031e313b3fbeb4d91e440e746e49bfa9dc` |
| `logo/wordmark-cream.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/wordmark-cream.svg) | `4a0bb63ef3d4712e0ada667d36b8b1f8b4b22cc4049468260d1742ab69cc4478` |
| `logo/wordmark-orange.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/wordmark-orange.svg) | `ba247fb4be9ee19803f487ee3abb048b5f0905ef944673a5a78cc4544a2a5906` |
| `logo/wordmark.svg` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/logo/wordmark.svg) | `4efa5c6a27904c18dcb2dc482d1d6c525fbcaabed74914129efa1af9e834fb4c` |
| `provenance/allowlist.json` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/provenance/allowlist.json) | `40b7842c9c30972e95e81f9fe7151aa954bf802d486b0108e244bc0164d38524` |
| `provenance/register.json` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/provenance/register.json) | `30472d4dc127b5fccf501093bca6ed85a9021383db464af93c6fc55704454a33` |
| `references/mockup-art-glasgow.webp` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/references/mockup-art-glasgow.webp) | `8041fade930456965ef0b746bdb1b41f7662004a83deaec08adb668c05467bad` |
| `references/mood-holo-light.webp` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/references/mood-holo-light.webp) | `bf2935f8e0db7ed568b9f1839e0a7976fb49c37d09650808b8552e8391036a26` |
| `references/mood-stub-back-golden-hour.webp` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/references/mood-stub-back-golden-hour.webp) | `63cf425858a83246b749c17a04e220e31267a55c461ff52d210a4e1b7423cb3a` |
| `references/ts-stamp-emboss-lightleak.webp` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/references/ts-stamp-emboss-lightleak.webp) | `fb7a818beb44a4b35ee52486d44ba5b3dfa059398ebc23cf9a1aa6398aa8df74` |
| `references/ts-stamp-holo-rainbow.webp` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/references/ts-stamp-holo-rainbow.webp) | `b3fc55964c28795c6ec94bdbded4a4ddab9d23ac49712772b7d0f02b36cb3926` |
| `references/ts-stamp-square-velvet.webp` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/references/ts-stamp-square-velvet.webp) | `825bd0fb2367a47829355f8d54645b733a911a11f01234f37f263d49be445b27` |
| `references/ts-stamp-vertical-velvet.webp` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/references/ts-stamp-vertical-velvet.webp) | `bc447d7200291944b236048285fc64f55b92d15e02a403359b02018c3d206eae` |
| `tokens/external-fonts-google.css` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/tokens/external-fonts-google.css) | `e197c96f9db0463aee326cb5db657cd9b9952d47a08e60420de6c6db117ba458` |
| `tokens/mapping.json` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/tokens/mapping.json) | `7db9104591711ff10a86f2fa26f2ec64fc995f3fb5eec9b7040be6ae363ffb45` |
| `tokens/profile.json` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/tokens/profile.json) | `18ce404d9e9f667bcab5a6cc0a87ca7be9e9866c5b7e69bff0c529e21742fef3` |
| `tokens/tailwind.preset.js` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/tokens/tailwind.preset.js) | `af3b702e62cb43965bef1d38385f880a9f90bc966b47e21979811240780b4fc1` |
| `tokens/token-matrix.md` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/tokens/token-matrix.md) | `c9fc0a1d799880c9625490582d472913d67d8585da4b97b37bf0277c98a1846c` |
| `tokens/tokens.css` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/tokens/tokens.css) | `a536e16aa1d25e45449a02e6ed46eeed376dfdbb71fa7c8a33cbc3a070f359b0` |
| `tokens/tokens.json` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/tokens/tokens.json) | `649e570dc1397ef78bc00b28127ce166d640a4187eb2889fb2f57cc54054f228` |
| `tools/build_logos.py` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/tools/build_logos.py) | `1b95bc5b9ca4a542cc02f49e3b3229fbcc10af06650073519033baa225d06a19` |
| `tools/build_tokens.py` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/tools/build_tokens.py) | `35b4ed388312ec01f7f4a8dd49ea809723d82cb89182bd7ac2d55b9a3e34b763` |
| `tools/token_lib.py` | [source](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/tools/token_lib.py) | `d93ef6f162aaaa129b66d85840955c224d35d3f861c3aeaa57dfe1ab12bbda97` |

To reproduce a row without altering files:

```sh
git show 3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4:logo/ts-stamp.svg | sha256sum
```

## Rationale

Preserve the six-color, two-family TicketStub work and C. Box Office rejection instead of inventing a rebrand. Separate an existing implementation from identity approval and separate a source link from distribution permission. The doc-only updates add evidence labels, channel/source navigation and current PR status; they select no alternative policy. The [usage guide](usage.md) demonstrates current rules while identifying the exact missing approval/export/accessibility conditions.

## Scope of approval

- **Covers:** a requested prospective decision on the enumerated master-brand elements, at reviewed hashes and within explicitly named product/landing/marketing/social/print contexts.
- **Does not cover:** live commerce, prices, shipping, customer or sponsor marks, event-specific asset rights, actual product capabilities, private customer screenshots, self-hosted runtime fonts, publication, or global release acceptance.

No scope is approved by this packet. A limited decision must list any excluded variants and consumers. Unsupported public claims stay labelled illustrative until their separate evidence and approved wording are recorded.

## Rights and provenance

The [provenance register](../provenance/register.json) and [allowlist](../provenance/allowlist.json) remain authoritative for exact-file clearance checks. The baseline allowlist is empty; no rights or approval is inferred from repository visibility, font notices, a logo's existence, creator attribution or a mockup caption. References stay excluded. The bundled OFL notices identify font license terms but do not fill missing upstream acquisition/version or third-party delivery evidence; exact local font checksums are already recorded. Record any real rights input through BK-06 rather than changing `UNKNOWN` to an assumed value.

## Affected consumers

| Consumer / owner boundary | Required input before a corresponding decision or release | Reviewer / notification evidence |
|---|---|---|
| getticketstub.com — app assembly | Exact consumed brand revision, app-versus-marketing theme scope, font network strategy, and tested asset/token imports | Reviewer appointment/ACK **pending**; [existing Product handoff](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/19#issuecomment-6121957840) remains the request of record. |
| landing-page-repo — rendered landing copy | Exact mark/theme/font adoption and evidence-backed public claims; disposition of the documented font/fallback/stamp differences | Reviewer appointment/ACK **pending**. [LP-06 source at `dda1b5d48e71ed9c111b82111676b7ef033fe5ef`](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/blob/dda1b5d48e71ed9c111b82111676b7ef033fe5ef/integration/brand-consumption.md) supplies provisional observations; [LP-02](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/4) owns rendered copy. |
| marketing-material — collateral and claim approval | MM-02 approved wording, imagery permissions, exact export version | Existing user-assigned marketing-material root/supervisor is the accountable content/brand/handoff reviewer and receiver per the [MM-06 role receipt](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/7#issuecomment-6105489382) and [later MM-02 confirmation](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/5#issuecomment-6112307412). Exact-artifact ACK and this packet's approval remain **pending**. |
| team-dashboard — internal financial UI | Token/typography/focus usage, exact imports, financial-state readability evidence | Reviewer appointment/ACK **pending**; [consumer issue #15](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/15). |
| creative-engine / print-production / fulfillment owner | Artwork-versus-master scope; printable composition, supported formats and permissions; no producer-defined foreign contract | Exact ACKs **pending**; [existing handoff receipt](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/10#issuecomment-6121958209) requests exact full-consumer evidence and explicitly preserves a blocked domain ACK. The earlier PR #3 receipt abbreviated this as `Fulfillment10#6121958209`; the destination was verified read-only on 2026-10-12. The shared-contracts owner retains canonical interfaces. |

This document is the reviewable packet, not a sent notification or an ACK. Existing owner requests are linked to avoid inventing or duplicating responses.

The marketing role receipt does not transfer that foreign supervisor's authority to
the brand-kit execution agent or supply source-owned identity/rights approval.
Landing's exact pinned record now supplies concrete review questions: six external
font families with differing axes/weights, fallback-order and Archivo display
adaptations, and a source stamp height of 21 CSS pixels against the existing 24-pixel
minimum. The [consumer observation matrix](consumers.md#landing-observations-at-the-inspected-revision)
records those inputs and their owners. No font, typography or size exception is
approved by adding that source evidence to this packet.

## Evidence and validation

The source/ancestry/PR audit is read-only. The baseline and alternative SHAs, exact hunk dispositions, current comments and hash manifest above are reproducible evidence. Required local checks for the combined candidate are `make check-links`, `make check-inventory`, `make check-governance`, affected token/accessibility checks, and `git diff --check`; exact executed revisions and results belong in the integration PR evidence. A passing structure check is not a brand decision. Browser, audio, fallback and consumer review remain required where their acceptance criteria call for them.

The public-copy negative fixture is documented in the [claim register](claims-register.md#negative-review-fixture). Any unlabelled claim of complete automation or a current fixed price must be rejected until the responsible owner supplies its pinned evidence and dated wording decision.

## Reviewers

| Role | Name | Dated evidence link | Verdict |
|---|---|---|---|
| Accountable approver | @CompleteDotTech | [Nomination only](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/8#issuecomment-6113526793) | **Pending** — nomination is not this packet's approval. |
| Technical token/export | Unknown | Pending appointment and acknowledgement | **Pending** |
| Provenance/rights | Unknown | Pending appointment and acknowledgement | **Pending** |
| Marketing consumer | Existing user-assigned marketing-material root/supervisor | [MM-06 role receipt](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/7#issuecomment-6105489382); [later MM-02 confirmation](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/5#issuecomment-6112307412) | **Pending** — existing role evidence is not this packet's approval or the exact-artifact ACK. |
| Other affected consumers | Unknown for each remaining required consumer | Pending explicit role ACKs and reviewed source evidence | **Pending** |
| Design recommendation sought from Lars | @lmvdz, identified in the owner's request | [Open BK-02.3 question](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/9#issuecomment-6118216028) | **Pending** — this request does not appoint every reviewer role. |

Documentation-only reconciliation follows [one independent reviewer other than the author](brand-governance.md#change-classes-bk-073), with the approver informed. Core decisions require the actual roles shown above; independent source review cannot substitute for them.

## Disposition

- **Decision date:** pending
- **Decision:** pending
- **Release eligible:** no
- **Deprecation / rollback / revocation notes:** no existing asset, token name, source path or direction is deprecated by this packet. Any approved amendment must name changed consumers, migration and a freshly authorized fallback under the governance process.
- **Fresh authorization for fallback:** not applicable; no rollback or reinstatement is proposed.

The next accountable action is a dated response selecting the exact direction/app-versus-marketing scope and individual variant/type/imagery/icon dispositions, with the missing reviewer appointments and evidence. Record it against the final reviewed files and hashes. BK-02, BK-05, the release gate and the epic remain open while their required outcomes are missing.
