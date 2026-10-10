# Contract Catalog

This catalog defines proposed interfaces for `shared-contracts`. It is design documentation, not a claim that schemas or generated clients have been implemented. Use [architecture section 5](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md#5-shared-contracts-and-data-ownership) for the producer and consumer map.

## Common envelope

| Field | Rule |
| --- | --- |
| `schema_version` | Explicit contract version; incompatible changes require a new supported version |
| `event_id` | Unique emitted event identity; stable when that event is redelivered |
| `tenant_id` | Derived from trusted server context and checked at every data boundary |
| `project_id` | Project scope for ownership and budget attribution |
| `correlation_id` | Links the customer journey; confers no authorization |
| `producer` | Module and relevant build revision |
| `occurred_at` | UTC time of the underlying action |
| `ingested_at` | UTC time the observation entered this system |
| `environment` | Development, test, or production execution context |
| `billing_mode` | Live, sandbox, or simulated economic behavior |
| `source_refs` | Provider request, evidence, artifact, or source record references |

Add only applicable IDs: `workflow_id`, `run_id`, `order_id`, `design_version_id`, `logical_operation_id`, `billable_attempt_id`, `transport_attempt_id`, and `provider_request_id`. A field that is unavailable must be omitted or explicitly unknown under the schema, not filled with a fabricated value.

## Domain contracts

| Contract | Required domain information | Invariant |
| --- | --- | --- |
| `ProjectRequest` | Source URL, customer input, output type, project permissions, budget scope | Browser-supplied scope cannot override authenticated ownership |
| `EventIntelligencePackage` | Facts, provenance per fact, retrieval times, conflicts, confidence basis, asset candidates | Unknown or conflicting facts remain visible; public discovery does not establish reproduction permission |
| `CreativeBrief` | Approved facts, visual intent, constraints, asset references, model policy | Exact event data stays distinct from creative interpretation |
| `DesignControlSchema` | Versioned allowlisted controls, labels, value types, ranges, default state | The model cannot emit executable UI code or privileged actions through the schema |
| `DesignVersion` | Parent version, artifact reference and hash, generation configuration, usage references | Edits create new versions; approval binds the displayed immutable version |
| `ProductionBundle` | Design hash, template and renderer versions, font references, files and hashes, print specification, preflight report | All shipped files have passed the chosen product checks |
| `FulfillmentQuote` | Provider, product, quantity, destination reference, shipping method, currency, charge breakdown, expiry | Quote identity and applicability survive display and approval |
| `OrderAuthorization` | Actor, tenant, order, quote identity, maximum amount, currency, product, quantity, destination reference, bundle hash, expiry | Changed purchase terms require renewed authorization |
| `UsageEvent` | Logical operation, billable attempt, provider request when available, usage units, outcome, completeness, source observation identity | Distinct billable attempts remain distinct; repeated observations do not add another charge |
| `BudgetReservation` | Budget scope, currency, held amount, consumed amount, policy version, lifecycle, attempt binding | Atomic acquisition and settlement prevent capacity reuse |
| `FinancialSummary` | Period, currency, included environments and billing modes, metric definitions, totals, coverage, reconciliation state, source references | Every total is reproducible from the financial projection and its stated policy |
| `EvaluationEvidence` | Scenario, component revisions, input identity, dependency mode, measured results, comparison basis | Simulated and live results remain distinguishable |

## Ownership of state

| Record | Owner | Other components use |
| --- | --- | --- |
| Tenant membership and customer project | Application | Authorized lookups and typed requests |
| Customer order and purchase authorization | Application | Read-only authorization checks and domain events |
| Workflow checkpoint and job lease | Harness | Job status and outcome events |
| Event facts and source cache | Event intelligence | Versioned research packages |
| Artwork version | Creative engine | Hash-bound asset references |
| Production artifact manifest | Print production | Immutable bundle references |
| Supplier submission identity and observations | Fulfillment | Normalized status events |
| Usage observation, budget hold, financial posting | Cost intelligence | Metering commands, budget protocol, summary projections |
| Evaluation run and evidence index | Integration evaluations | Sanitized evidence references |

## Financial identities and lifecycles

Use separate concepts for the customer's logical operation, each potentially billable execution, and each transport retry. A network retry of a supplier submission may retain the same external idempotency identity; a second generated image may be a new billable attempt. The provider adapter must declare that mapping instead of forcing a universal retry rule.

Keep valuation basis (`unknown`, `estimated`, `provider_confirmed`), settlement (`unpaid`, `partly_paid`, `paid`), reconciliation (`unmatched`, `matched`, `exception`), and reservation lifecycle separate. Refunds, credits, reversals, and payments are linked events. Reservation expiry is eligible only when execution is known not to be in flight; an uncertain side effect needs a hold and reconciliation.

Amounts use exact decimal or appropriately scaled integer representation. Preserve original currency, rate-card version, effective date, conversion source and timestamp where applicable, and a documented rounding boundary. A dashboard displaying cents must not erase sub-cent usage from the ledger.

## Compatibility acceptance

- Validate one valid and one invalid example for each core contract.
- Reject an unsupported major version with a typed, actionable error.
- Define whether unknown additive fields are preserved or ignored.
- Exercise duplicate delivery and old-consumer behavior.
- Test server-side authorization with forged tenant, order, and artifact identifiers.
- Keep serialization deterministic where hashes or approvals bind serialized content.
- Review schema changes with at least one affected producer and consumer.

## Error model

Errors identify the module, operation, typed code, retryability, safe user message, and supporting diagnostic reference. Examples include source unavailable, conflicting facts, budget unavailable, unsupported product, preflight failure, stale authorization, provider timeout, and unknown billing. A retryable flag never independently authorizes spending or bypasses the attempt and budget limits.
