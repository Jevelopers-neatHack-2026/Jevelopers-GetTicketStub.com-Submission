# `landing-page-repo`

**Repository status:** Verified existing on GitHub, private, October 10, 2026.
**Proposed owner:** Product and frontend.
**Delivery state:** Architecture plan; implementation criteria remain planned until evidence is recorded.

## Responsibility

Own the public introduction: product purpose, audience, representative output, and the route into the customer application. Keep marketing content distinct from authenticated design and ordering workflows.

For the initial deployment, provide a static build that the main web application can serve at `/`. A separate source repository does not require an additional running web service. Coordinate route ownership with `getticketstub.com` before integration.

## Planned internal modules

- `src/sections/`: Product explanation, examples, process, and calls to action.
- `src/content/`: Approved copy and content metadata.
- `src/components/`: Presentation components consuming shared brand tokens.
- `public/`: Reviewed images and static assets.
- `integration/`: Build-output contract and route expectations.
- `review/`: Link, accessibility, and content verification notes.

## Dependencies and handoff

Consume identity guidance from `brand-kit` and approved messages from `marketing-material`. Receive application entry URLs and supported product behavior from `getticketstub.com`. Marketing claims should reference the demonstrated release, with future features clearly identified.

## P0 demo slice

Create one responsive landing page with an understandable product description, an approved example, and a working path into the demonstration. Add a waitlist only if its data collection and receiving endpoint are deliberately included in scope.

## Acceptance boundary

- [ ] Static output integrates with the primary application without route conflicts.
- [ ] Primary calls to action reach the intended customer experience.
- [ ] Example images and product claims match approved materials.
- [ ] The page works at the agreed mobile and desktop widths.
- [ ] Any collection form has a defined owner and clear handling behavior.
- [ ] No secrets or private team content enter public assets.

[Architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) · [Acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

## Acceptance and contributor handoff

Use the [repository acceptance view](ACCEPTANCE.md) and [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md). Interfaces are specified in the [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md). Preserve local contributor and agent instructions; follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.
