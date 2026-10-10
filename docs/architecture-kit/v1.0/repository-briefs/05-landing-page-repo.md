# `landing-page-repo`

**Repository status:** Existing name supplied by the team.  
**Proposed owner:** Product and frontend.  
**Delivery state:** Planning only; all checks pending.

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

[Architecture](../docs/architecture.md) · [Acceptance checklist](../planning/acceptance-checklist.md).
