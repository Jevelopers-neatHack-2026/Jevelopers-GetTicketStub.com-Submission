# brand-kit responsibility and current source boundary

**Repository role:** First-party identity sources, working assets, token tooling and usage guidance. **Accountable role:** Product and frontend. **Observed source:** main at `a664cc99884b2679f2c6ea15c6c3e8b98b768755`, audited 2026-10-12.
**Delivery state:** Source, generated assets and local validation are implemented. Identity ratification and versioned distribution remain pending; the production export allowlist is empty.

## Responsibility

Maintain TicketStub brand inputs and usage guidance: marks, token values, typography references, voice, imagery, motion, material treatments and the provenance needed to decide what can be redistributed. Keep original files, generated exports and proposed consumer subsets distinguishable. A file's presence, local rendering or passing token check does not certify its rights, approval, release status or consumer adoption.

## Current repository organization

- `logo/`, `fonts/`, `tokens/`: canonical identity artwork, licensed font source files and token source/material.
- `tokens/tokens.json` is the source for existing values; `profile.json` and `mapping.json` constrain output. CSS and Tailwind files are generated derivatives; `external-fonts-google.css` is an opt-in proposal, not a default runtime.
- `logo/` contains fourteen outlined SVGs generated from the bundled Fraunces source font. The asset toolchain can create local review-only raster candidates, but does not produce an approved distribution package.
- references/, inventory/, provenance/: reference assets, inventory data and source/rights metadata. Entries with unresolved permissions remain restricted from public export.
- tools/: offline generation and validation utilities; Makefile documents their entry points.
- docs/: source-of-truth, token profile, logo and imagery use, provenance, voice, material, motion and governance guidance.
- SPEC.md: maintained identity specification and local interface guidance.

These are the files that exist in main, not a promised future module layout. A generated or proposed export should retain its input hashes and approval/provenance record. The source has no selected `brand_version`, no approved export subset and no consumer ACK; do not describe local files, copied logos, build manifests or passing validators as a versioned brand release. Do not overwrite original evidence or imply that a consumer has taken a reviewed release. See [asset exports](../asset-exports.md), [distribution](../distribution.md), [provenance](../provenance.md) and the [claim register](../claims-register.md) for their detailed boundaries.

## Existing compatible decisions

The existing TicketStub identity, SPEC.md, source assets, fonts and token files remain the repository's source materials. This ownership page describes current files and boundaries; it does not relocate them, ratify a release version, or override detailed brand governance. Proposed consumer copies need their own source pin, rights evidence and approval.

## Consumers and current handoff

The getticketstub.com application has local public brand files and styles, but current source inspection found no approved/versioned brand-kit package dependency or byte-identity receipt. Landing, dashboard and marketing repositories may carry scoped copies or reference assets; each consumer's source pin and approval evidence must be verified independently. This repository does not deploy or enforce visual identity inside those consumers.

PR #3 is active on the review horizon for studio/link documentation; changes proposed there are not part of the observed main source until merged. Consult live PR and issue state before editing overlapping material. Existing permission gaps, font redistribution restrictions, publication allowlists and governance decisions remain owned by their source records; do not weaken them to make an export pass.

The getticketstub.com app currently carries local brand files and source comparisons; its host-side root page and current connections are described in the app's [current architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) (available after the companion documentation PR merges). This relationship does not provide a package dependency, establish byte lineage beyond the exact reviewed comparison, grant asset permission, or accept the consumer integration.

## Validation and contributor handoff

Use make check for the local documented token, inventory and file-integrity checks. The provenance check can fail while required rights, approval or public-allowlist evidence is missing; that failure is a meaningful publication block, not a reason to relax the policy. Do not make provider calls or copy secrets into public asset metadata. Follow local contributor/security instructions and the [organization contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md).

## Architecture and acceptance sources

- [Current host architecture and cross-repository integration state](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) (available after the companion documentation PR merges).
- [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md): immutable dated design intent, not a current dependency map.
- [Local acceptance view](ACCEPTANCE.md) and [master integration-evals checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/56018576a9450a2bb46aa55ed3b2f9d9ae97e50d/planning/acceptance-checklist.md). The master record owns shared criterion state and evidence.
- Existing [source-of-truth](../source-of-truth.md), [provenance](../provenance.md) and [brand governance](../brand-governance.md) docs remain the detailed authority for this repository's sources and permissions.
