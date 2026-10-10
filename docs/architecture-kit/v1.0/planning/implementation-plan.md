# Implementation Plan

Use this plan with the [architecture guide](../docs/architecture.md) and [acceptance checklist](acceptance-checklist.md). All assignments below are proposed roles. Select the actual owners during kickoff.

## Kickoff decisions

| Decision | Owner role | Required record |
| --- | --- | --- |
| Repository and review ownership | Product and frontend | One accountable owner and reviewer per engineering repository |
| Event and customer example | Product with agent owner | One supported URL and expected facts |
| Image provider and model | Creative and fulfillment | Model configuration and measured-call budget |
| Printable product | Creative and fulfillment | Provider SKU, dimensions, bleed, resolution, and permitted file formats |
| Development budget | Captain with finance owner | Currency, reporting basis, initial limit, and exception policy |
| Identity and data access | Product and frontend | Tenant model, captain/member roles, service permissions |
| Sponsor accounts | Relevant domain owners | Accessible accounts and evidence capture responsibilities |
| Publication scope | Captain | Inspectable implementation repositories and approved public evidence |
| Integration baseline | Product and frontend | Component manifest format, dependency order, and migration owners |

## Work packages

| ID | Work package | Dependencies | Primary owner | First result |
| --- | --- | --- | --- | --- |
| WP01 | Minimal contracts and representative fixtures | Kickoff decisions | Agent and research | Valid and invalid fixtures for the core journey |
| WP02 | Application assembly and identity | WP01 | Product and frontend | Authenticated project record and job submission |
| WP03 | Metered calls and project budget reservations | WP01 | Finance and reliability | One attributable provider call with a held and settled budget |
| WP04 | Agent state and research | WP01, WP02, WP03 | Agent and research | Verified event package and durable checkpoint |
| WP05 | Artwork generation and revision | WP01, WP03, WP04 | Creative and fulfillment | Two related image versions and an approval record |
| WP06 | Production template and preflight | WP01, WP05 | Creative and fulfillment | Personalized export and artifact manifest |
| WP07 | Financial reporting and dashboard | WP02, WP03 | Finance and reliability | Cost, budget, data-quality indicators, and drilldown |
| WP08 | Supplier sandbox integration | WP01, WP06 | Creative and fulfillment | Quote and bound authorization followed by a recorded submission |
| WP09 | Integration recovery and accounting scenarios | WP04, WP06, WP07, WP08 | Finance and reliability with domain owners | Repeatable full journey and required failure evidence |
| WP10 | Submission narrative and business plan inputs | WP07, WP09 | Product with finance owner | Demo storyboard, evidence index, and measured CFO summary |

Schema agreement unblocks work on provider substitutes. WP03 starts before the first real AI request. WP07 can begin with deterministic ledger fixtures while WP04 and WP05 develop. Validate product specifications early during WP06 planning; do not wait until finished artwork reveals an unsupported print size.

## Minimum delivery

The first complete journey covers one event source, one image provider, one ticket template, one edit, one personalized output, one supplier sandbox, and one project budget. The dashboard displays measured AI usage and its estimated or provider-confirmed costs separately from simulated customer revenue. If a provider is unavailable, use an explicit substitute for development and retain the real integration as pending.

The financial model starts with a documented project reporting policy. Define when an order counts as a sale, how refunds relate to sales, which costs are direct, and whether a chart includes estimates. A real cash figure requires an opening balance and reconciled movements or a connected account; it cannot be inferred from a sales total alone.

## Release handoff

1. Resolve contract changes and update the tested component revisions.
2. Build from a clean checkout with the chosen runtime and dependency lockfile.
3. Apply the owned migration set once, in the integration order.
4. Execute the complete synthetic customer journey and the failure scenarios applicable to the selected release scope in the checklist.
5. Compare the release manifest, artifact hashes, trace IDs, and financial records.
6. Record incomplete integrations and unresolved billing differences next to the corresponding evidence.
7. Prepare publication and submission materials for the designated team owner.

No item is accepted solely because a component's unit tests pass. The integration owner records the assembled revisions, environment, provider mode, and evidence for the complete release.

## Future separation

| Candidate repository | Separate when |
| --- | --- |
| `commerce-service` | Payment, refund, tax, invoicing, and subscription responsibilities warrant an independent owner |
| `customer-support-agent` | Support workflows and customer-service permissions become substantial |
| `platform-infrastructure` | Several environments, deployment automation, and operations require dedicated ownership |
| `provider-catalog` | Product specifications, capabilities, and supplier prices need independent maintenance |
| `analytics-intelligence` | Funnel analysis and experiments need a distinct analytical pipeline |
| `mobile-app` | A native customer application has a validated use case |

These candidates are outside the fourteen-repository target. Until justified, their capabilities remain within the existing owners.
