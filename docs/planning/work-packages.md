# P0 work-package tracking

Work packages are planned implementation tasks. Dependencies link to issues in the owning repositories. Split packages retain one work-package ID and distinct domain responsibilities. None are completed by documentation distribution.

| Package | Repository | Issue | Dependencies |
| --- | --- | --- | --- |
| WP01 | shared-contracts | [Minimal contracts and representative fixtures](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/1) | Kickoff decisions |
| WP02 | getticketstub.com | [Application assembly and identity](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/1) | WP01 |
| WP03 | cost-intelligence | [Metered calls and project budget reservations](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/1) | WP01 |
| WP04 | agent-harness | [Durable agent state and bounded recovery](https://github.com/Jevelopers-neatHack-2026/agent-harness/issues/1) | WP01, WP02, WP03 |
| WP04 | event-intelligence | [Sourced event research and safe retrieval](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/1) | WP01, WP02, WP03 |
| WP05 | creative-engine | [Artwork generation and versioned revision](https://github.com/Jevelopers-neatHack-2026/creative-engine/issues/1) | WP01, WP03, WP04 |
| WP06 | print-production | [Production template and preflight](https://github.com/Jevelopers-neatHack-2026/print-production/issues/1) | WP01, WP05 |
| WP07 | cost-intelligence | [Financial reporting and CFO summary](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/2) | WP02, WP03 |
| WP07 | team-dashboard | [Authorized financial dashboard and drilldowns](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/1) | WP02, WP03 |
| WP08 | fulfillment-connectors | [Supplier sandbox quote and authorized submission](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/1) | WP01, WP06 |
| WP09 | integration-evals | [Integrated recovery and accounting scenarios](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/1) | WP04, WP06, WP07, WP08 |
| WP10 | marketing-material | [Submission narrative and evidence classification](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/1) | WP07, WP09 |
| WP10 | cost-intelligence | [CFO.ai business plan inputs and actual plan evidence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/3) | WP07, WP09 |
