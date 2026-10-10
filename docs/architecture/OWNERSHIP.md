# `brand-kit`

**Repository status:** Verified existing on GitHub, private, October 10, 2026.
**Proposed owner:** Product and frontend.
**Delivery state:** Architecture plan; implementation criteria remain planned until evidence is recorded.

## Responsibility

Own the product's visual identity and the reusable guidance that keeps its interfaces and communications consistent. Define approved logos, typography, colors, spacing, icon treatment, and tone of voice. Preserve the repository and product names supplied by the team until the team chooses a naming change.

This repository owns the product's identity assets. Event-specific brand research, asset discovery, and permission evaluation belong to `event-intelligence`; application behavior belongs to the consuming applications.

## Planned internal modules

- `identity/`: Product marks, approved variants, and export guidance.
- `tokens/`: Color, typography, spacing, and component design tokens.
- `guidelines/`: Identity usage, accessibility, and writing guidance.
- `components/`: Documented visual patterns suitable for shared implementation.
- `licenses-and-provenance/`: Asset origin, permissions, and redistribution constraints.
- `releases/`: Version notes and consumer migration guidance.

## Dependencies and handoff

Provide a versioned, appropriately publishable asset subset to `getticketstub.com`, `landing-page-repo`, `team-dashboard`, and `marketing-material`. Agree with interface owners which patterns should be implemented as reusable components. Avoid creating competing token definitions inside each application.

## P0 demo slice

Deliver one coherent identity set, a compact token specification, and the essential interface states used in the product demonstration. Include approved examples of customer-facing ticket previews and internal financial screens without requiring identical layouts.

## Acceptance boundary

- [ ] Core consumers identify the same approved identity version.
- [ ] Text and interactive states remain readable in the demonstrated layouts.
- [ ] Asset permissions and any redistribution restrictions are recorded.
- [ ] Public exports omit private or unapproved source material.
- [ ] Proposed component behavior has a named application owner.

[Architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) · [Acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

## Existing compatible decisions

The existing TicketStub identity, `SPEC.md`, logos, fonts and token sources remain authoritative. Proposed module paths describe future organization and do not relocate existing assets. The edition-system link to `ticket-studio` in the existing README is outside this fourteen-repository plan and requires separate owner confirmation.

## Acceptance and contributor handoff

Use the [repository acceptance view](ACCEPTANCE.md) and [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md). Interfaces are specified in the [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md). Preserve local contributor and agent instructions; follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.
