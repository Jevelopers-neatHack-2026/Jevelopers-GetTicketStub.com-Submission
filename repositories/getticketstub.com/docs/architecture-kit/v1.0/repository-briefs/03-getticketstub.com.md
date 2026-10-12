# `getticketstub.com`

**Repository status:** Existing name supplied by the team; preserved as provided.  
**Proposed owner:** Product and frontend.  
**Delivery state:** Planning only; all checks pending.

## Responsibility

Own the customer application, authentication, public API boundary, customer projects, design approvals, and customer order lifecycle. Act as the composition root that assembles the separately maintained modules into one reproducible application.

Use Next.js as the proposed web framework, with ChatKit and a design canvas for customer interaction. The initial deployment uses one web application and one background worker. Mount `team-dashboard` within authenticated administration routes. Serve the landing repository's static output at `/`.

## Planned internal modules

- `src/customer/`: Project creation, conversation, design review, and downloads.
- `src/api/`: Authentication, authorization, request validation, and public endpoints.
- `src/orders/`: Customer order transitions and verified purchase authorization.
- `src/composition/`: Module integration and worker entry points.
- `integration/`: Workspace assembly and dependency revision manifest.
- `release/`: Release metadata, setup instructions, and submission references.

## Dependencies and handoff

Consume shared interfaces, brand tokens, the dashboard module, and specialist capabilities. Store dependency revisions in the integration manifest. Record this repository's own revision in release metadata, avoiding a recursive self-reference in its committed dependency pins.

## P0 demo slice

Provide URL submission, one research-and-design conversation, revision, version approval, artifact download, and an authorized sandbox fulfillment journey. Publish a documented clean-workspace assembly process and a coherent submission entry point.

## Acceptance boundary

- [ ] Customer and team routes enforce their intended access rules.
- [ ] Purchase authorization follows review of the final composed preview and binds its production hash and fulfillment terms.
- [ ] Customer order state has one authoritative owner.
- [ ] The documented pinned workspace produces an integrated build.
- [ ] Dashboard and landing sources integrate into the planned web deployment.
- [ ] Release evidence identifies each included repository revision.

[Architecture](../docs/architecture.md) · [Acceptance checklist](../planning/acceptance-checklist.md).
