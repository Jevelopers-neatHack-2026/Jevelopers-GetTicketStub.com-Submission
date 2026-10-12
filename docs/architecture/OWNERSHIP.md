# marketing-material responsibility and publication boundary

**Repository role:** First-party product messaging, examples, demonstration materials, review records and release handoff. **Accountable content/review owner:** Marketing-material supervisor assigned by the user on 2026-10-11; MM-01 implementation role is Product and frontend — collateral maintainer. Independent review for a frozen candidate remains separately required. **Observed source:** main at `79ae21607eb4d98188f85ce3c42b8be6eb5688bc`, audited 2026-10-12.

## Responsibility

Maintain the words and evidence used to explain the product. Keep draft copy, product observations, synthetic examples, approved claims, asset rights and external-release decisions clearly separated. This repository consumes technical and brand evidence; it does not own identity source files, application behavior, the financial ledger, or authoritative event data.

## Current repository organization

- messaging/: product claims and approved-language candidates with evidence references.
- demo/: storyboard, scripts and recording support. Recording or publication status is tracked separately from written drafts.
- launch/: release copy and destination-specific drafts.
- examples/: illustrative artifacts and their source, permissions and evidence classification.
- review/: claim/evidence review records, privacy and release decisions.
- docs/: collateral inventory, organization, handoff and risk guidance.
- tools/, tests/: local inventory/provenance checks and tests.
- release/: retained rehearsal or candidate material; generated/copied outputs and their digests are historical evidence, not mutable source.

This describes actual top-level areas in main. The files under those paths have different approval state. Use the [collateral inventory](../collateral-inventory.json), [organization guide](../collateral-organization.md), [handoff](../collateral-handoff.md), and each asset's provenance/review record before selecting a deliverable. Do not treat a draft, rehearsal, source inspection, or local validator pass as permission to publish.

## Current handoff boundary

The repository contains implemented documentation, candidate copy and offline validation, but external publication readiness is a separate decision and remains blocked while required review/evidence gates are incomplete. Current public-facing material must distinguish local, synthetic, sandbox, pending and production evidence. Price, materials, shipping, live provider use, customer outcomes and other measurable claims require their own current source and approval. A readiness report cannot substitute for a confirmed owner or independent review.

Active pull requests may own specific launch, recording, handoff or provenance paths. Check current PR ownership before editing them; preserved release artifacts and their digests must remain unchanged. Cross-repository master acceptance is maintained by integration-evals and the issue owners.

## Validation and contributor handoff

Run the repository's documented local checks in tools/ and tests/ with synthetic inputs. Report each command and result without converting a draft-only or expected blocked result into a release pass. Never place customer information, secrets, provider payloads or private team records in public collateral. Follow repository-local instructions and the [organization contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md).

## Architecture and acceptance sources

- [Current host architecture and integration state](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) (available after the companion documentation PR merges).
- [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md): immutable dated design intent.
- [Local acceptance view](ACCEPTANCE.md) and [master integration-evals checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/56018576a9450a2bb46aa55ed3b2f9d9ae97e50d/planning/acceptance-checklist.md).
- Current source, issue owner comments and repository PRs determine whether an individual asset or claim is publishable; this ownership guide does not grant that permission.
