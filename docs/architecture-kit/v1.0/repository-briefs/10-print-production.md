# `print-production`

**Repository status:** Proposed addition; creation is not claimed.  
**Proposed owner:** Creative and fulfillment.  
**Delivery state:** Planning only; all checks pending.

## Responsibility

Convert an approved artwork version and verified event details into deterministic customer and supplier artifacts. Own text composition, personalization, template dimensions, export, preflight checks, and artifact manifests.

Bind each production bundle to its design, template revision, and supplier specification. Define reproducibility through preserved inputs, renderer version, and expected output properties. Byte-identical exports require controlled metadata and rendering dependencies.

## Planned internal modules

- `src/composition/`: Artwork, exact text, and approved logo layers.
- `src/templates/`: Ticket layouts and supported product specifications.
- `src/personalization/`: Validated attendee fields; CSV batch import is a P1 extension.
- `src/preflight/`: Dimensions, bleed, resolution, and content integrity.
- `src/exporters/`: SVG, PNG, PDF, and bundle packaging.
- `src/manifests/`: Input versions, output hashes, and validation results.

## Dependencies and handoff

Consume immutable versions from `creative-engine`, event facts from `event-intelligence`, and interfaces from `shared-contracts`. Obtain the selected product's requirements through `fulfillment-connectors`. Deliver verified downloads to `getticketstub.com` and supplier-compatible references to fulfillment. Supplier-specific upload or order behavior stays with the connector.

## P0 demo slice

Support one chosen ticket layout and one confirmed supplier specification. Produce a customer preview and a usable production bundle with exact event text. Demonstrate that a deliberately invalid input fails preflight before submission.

## Acceptance boundary

- [ ] Event text and personalization match the validated source values.
- [ ] Output dimensions and required bleed match the chosen specification.
- [ ] Unsupported fonts, missing assets, and insufficient resolution are reported.
- [ ] Bundle manifests identify their inputs, checks, and output integrity values.
- [ ] A failed preflight prevents the dependent fulfillment submission.
- [ ] Approved artifacts remain tied to their immutable design version.

[Architecture](../docs/architecture.md) · [Acceptance checklist](../planning/acceptance-checklist.md).
