# brand-kit responsibility and current source boundary

**Repository role:** First-party identity sources, working assets, token tooling and usage guidance. **Accountable role:** Product and frontend. **Observed source:** main at `a664cc99884b2679f2c6ea15c6c3e8b98b768755`, audited 2026-10-12.
**Delivery state:** Source, generated assets and local validation are implemented. Identity ratification and versioned distribution remain pending; the production export allowlist is empty.

**Repository visibility record:** Public on GitHub. The [preserved 2026-10-12 record](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/a664cc99884b2679f2c6ea15c6c3e8b98b768755/docs/architecture/OWNERSHIP.md) states that `gh repo view Jevelopers-neatHack-2026/brand-kit --json visibility,isPrivate` returned `visibility: PUBLIC`, `isPrivate: false` at about 04:13 UTC. The earlier verified private status from 2026-10-10 is superseded history. No repository settings were changed.

## Responsibility

Maintain TicketStub brand inputs and usage guidance: marks, token values, typography references, voice, imagery, motion, material treatments and the provenance needed to decide what can be redistributed. Keep original files, generated exports and proposed consumer subsets distinguishable. A file's presence, local rendering or passing token check does not certify its rights, approval, release status or consumer adoption.

Event-specific brand research, asset discovery and permission evaluation remain with `event-intelligence`; application behavior remains with the consuming applications.

## Current repository organization

- `logo/`, `fonts/`, `tokens/`: canonical identity artwork, existing source-only TTFs with bundled OFL notices, and token source/material. Exact font acquisition and rights verification remain pending in [provenance](../provenance.md); source notices do not authorize self-hosted runtime delivery.
- `tokens/tokens.json` is the source for existing values; `profile.json` and `mapping.json` constrain output. CSS and Tailwind files are generated derivatives; `external-fonts-google.css` is an opt-in proposal, not a default runtime.
- `logo/` contains fourteen outlined SVGs generated from the bundled Fraunces source font. The asset toolchain can create local review-only raster candidates, but does not produce an approved distribution package.
- references/, inventory/, provenance/: reference assets, inventory data and source/rights metadata. Entries with unresolved permissions remain restricted from public export.
- tools/: offline generation and validation utilities; Makefile documents their entry points.
- docs/: source-of-truth, token profile, logo and imagery use, provenance, voice, material, motion and governance guidance.
- SPEC.md: maintained identity specification and local interface guidance.

These are the files that exist in main, not a promised future module layout. A generated or proposed export should retain its input hashes and approval/provenance record. The source has no selected `brand_version`, no approved export subset and no consumer ACK; do not describe local files, copied logos, build manifests or passing validators as a versioned brand release. Do not overwrite original evidence or imply that a consumer has taken a reviewed release. See [asset exports](../asset-exports.md), [distribution](../distribution.md), [provenance](../provenance.md) and the [claim register](../claims-register.md) for their detailed boundaries.

## Existing compatible decisions

The existing TicketStub identity, SPEC.md, source assets, fonts and token files remain the repository's source materials. This ownership page describes current files and boundaries; it does not relocate them, ratify a release version, or override detailed brand governance. Proposed consumer copies need their own source pin, rights evidence and approval.

The original `ticket-studio` reference required owner confirmation; [PR #2](https://github.com/Jevelopers-neatHack-2026/brand-kit/pull/2) preserved that handoff. `creative-engine` retains artwork-version ownership and `print-production` retains printable-composition ownership. Documentation links do not reassign edition contracts, product capabilities or brand direction. Shared interfaces remain specified by the [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md).

## Consumers and current handoff

The getticketstub.com application has local public brand files and styles, but current source inspection found no approved/versioned brand-kit package dependency. A read-only comparison on 2026-10-12 verified that all 14 `public/brand/*.svg` Git blob IDs at product `783a9fa03e3d64b752cd8c5ad913c223db29118d` match brand-kit `logo/*.svg` at `3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4`; the [source-of-truth record](../source-of-truth.md#repository-status-and-open-handoffs) preserves that exact comparison. It supplies no rights, deployment evidence or consumer ACK. Landing, dashboard and marketing repositories may carry scoped copies or reference assets; each consumer's source pin and approval evidence must be verified independently. This repository does not deploy or enforce visual identity inside those consumers.

[PR #22](https://github.com/Jevelopers-neatHack-2026/brand-kit/pull/22) already merged the pinned edition/foil source links at brand-kit `3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4`, targeting product `43bb721f00de1c616e8e8d27efbb87c6bf75bcbf`. [PR #3](https://github.com/Jevelopers-neatHack-2026/brand-kit/pull/3) retains unique paper-only app, foil and sound proposals awaiting a scoped owner decision; the [hunk disposition](../identity-decision-packet.md#pr-3-reconciliation) separates those proposals from the integrated link work. Consult live PR and issue state before editing overlapping material. Existing permission gaps, font redistribution restrictions, publication allowlists and governance decisions remain owned by their source records; do not weaken them to make an export pass.

The getticketstub.com app currently carries local brand files and source comparisons; its host-side root page and current connections are described in the app's [current architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) (available after the companion documentation PR merges). This relationship does not provide a package dependency, establish byte lineage beyond the exact reviewed comparison, grant asset permission, or accept the consumer integration.

The companion [getticketstub.com PR #117](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/117) must merge before this documentation change so those `main` links resolve. Its merge and the resulting link targets must be checked separately; a local link check does not verify external URLs or satisfy this prerequisite.

## Validation and contributor handoff

Use make check for the local documented token, inventory and file-integrity checks. The provenance check can fail while required rights, approval or public-allowlist evidence is missing; that failure is a meaningful publication block, not a reason to relax the policy. Do not make provider calls or copy secrets into public asset metadata. Follow local contributor/security instructions and the [organization contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md).

## Architecture and acceptance sources

- [Current host architecture and cross-repository integration state](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) (available after the companion documentation PR merges).
- [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md): immutable dated design intent, not a current dependency map.
- [Local acceptance view](ACCEPTANCE.md) and [master integration-evals checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/56018576a9450a2bb46aa55ed3b2f9d9ae97e50d/planning/acceptance-checklist.md). The master record owns shared criterion state and evidence.
- Existing [source-of-truth](../source-of-truth.md), [provenance](../provenance.md) and [brand governance](../brand-governance.md) docs remain the detailed authority for this repository's sources and permissions.
