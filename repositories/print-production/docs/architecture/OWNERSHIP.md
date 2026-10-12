# print-production ownership and implementation boundary

**Repository status:** Public on GitHub; verified October 12, 2026.
**Proposed owner:** Creative and fulfillment.
**Implementation state:** A private Node.js 24.21.0 / npm 11.19.0 package implements composition, personalization, preflight, export, bundle and local verification surfaces. Local implementation does not establish consumer adoption, supplier approval or production acceptance.

## Responsibility

Convert an approved artwork version and verified event details into deterministic customer and supplier artifacts. Own text composition, personalization, template dimensions, export, preflight checks, and artifact manifests.

Bind each production bundle to its design, template revision, and supplier specification. Define reproducibility through preserved inputs, renderer version, and expected output properties. Byte-identical exports require controlled metadata and rendering dependencies.

## Current implementation surface

The package exports a root API, candidate adapter subpath and pp-verify command. Source includes composition primitives, canonical/private renderers, template and font assets, personalization and CSV batch validation, SVG/PNG/PDF exporters, preflight inspection, artifact manifests, local storage, durable batch jobs, and offline verification suites.

The bundled shared-contracts 0.9.7 archive is a pinned candidate dependency, not an accepted cross-repository contract. Check owner evidence before treating a bundle as consumer-conformance proof. Current app main does not import this package at runtime.

## Integration targets and handoff

Inputs are intended to include immutable design versions and event facts. Product requirements must come from an owner-approved fulfillment interface. Customer downloads and supplier-compatible references belong at their respective app and connector boundaries. Builds/tests are local and do not submit supplier orders. See [runtime CI workload](../runtime/CI-WORKLOAD.md) and [integration-evals handoff](../integrations/integration-evals.md) for verification procedures and limits.

## P0 target slice

Design intent: support one chosen ticket layout and confirmed supplier specification; produce a customer preview and usable production bundle with exact event text; and show invalid input failing preflight before submission. This is not a completion claim.

## Acceptance boundary

- [ ] Event text and personalization match the validated source values.
- [ ] Output dimensions and required bleed match the chosen specification.
- [ ] Unsupported fonts, missing assets, and insufficient resolution are reported.
- [ ] Bundle manifests identify their inputs, checks, and output integrity values.
- [ ] A failed preflight prevents the dependent fulfillment submission.
- [ ] Approved artifacts remain tied to their immutable design version.

The canonical current-state architecture describes implementation across repositories. The historical v1.0 architecture kit remains design intent: [current organization architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) · [v1.0 design intent](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md).

Use the [repository acceptance view](ACCEPTANCE.md) for criterion allocation only. Current criteria and evidence live in the [master checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) and [JSON tracker](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.json). See the [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md), [contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md) and [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.

For a guide-by-topic list, see the [documentation index](../INDEX.md).
