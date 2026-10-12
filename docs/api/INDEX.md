# Cost-intelligence API map

This package is a host-composed finance library, not a running service. The root and ESM subpaths expose typed operations; implementations require their documented authority, database, source and storage ports. Local source and tests do not establish shared-contract acceptance, application adoption, real issuer integration or financial acceptance.

| Area | Current local behavior | Remaining boundary |
| --- | --- | --- |
| Metering | Scoped usage intake and outbox recovery work when ports are configured. | No provider ingestion adapter or app integration is supplied. |
| Pricing | Versioned v2 catalog writes and exact non-posting estimates are implemented behind host ports. | Legacy 1.0.0 estimate remains typed unavailable; estimates do not authorize budgets or post charges. |
| Budgets | CI05A reservation authorization, snapshot, revalidation, dispatch and policy operations use the configured PostgreSQL Finance authority. | Public settlement/release and expense-adjustment posting remain unavailable; nested scopes are deferred under issues [#17](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/17) and [#18](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/18). |
| Ledger | Scoped PostgreSQL append and immutable projection/replay operations are implemented. | Financial-event intake and direct quarantine resolution are unavailable. |
| Reporting | Scoped queries, immutable snapshots and prepared-export functions work with configured ports; [packet-specific synthetic ACKs](cfo-ai-handoff.md#accepted-synthetic-handoffs) are recorded. | Broader shared-contract adoption, new reported-unsettled compatibility/ACKs, actual host issuer/fence adoption and CFO.ai delivery/import remain pending. |
| Evidence and lineage | Existing ledger-reference lookups support injected and PostgreSQL readers; stored-lineage reads bounded intake/outbox and known reporting-snapshot input metadata. | Reads return no amounts or billing authority and do not write ledger events. Reconciliation, adjustment and export lineage gaps remain; real PostgreSQL and host acceptance are separate. |
| Reconciliation | The v2 coverage-only dry-run/read API stores and returns source-coverage metadata; successful results remain `needs_review`, `financialEffects: false`, and `billingAuthority: false`. | Legacy v1.0.0 `startReconciliation`/`getReconciliation` remain `RECONCILIATION_PENDING`; matching, financial variance, corrections, settlement and hold release are unavailable. See [coverage-only details](reconciliation-coverage-v2.md). |
| CFO.ai | Manual mapping and prepared file formats are documented. | There is no connector or automatic plan delivery. |

## Version and data rules

Finance requests use exact schema versions. Pricing preserves its 1.0.0 encoding and exposes incompatible operations under explicit v2 names; reporting and rich prepared exports also define explicit v2 forms. Unsupported versions and unknown fields reject. Follow each domain guide's combined validator for nested shared-contract values.

Amounts and quantities are decimal strings, not binary floating point. Economic billing modes are live, sandbox and simulated; funding sources are separate. Trusted scope binds tenant, project, environment, billing mode and actor. A request scope is authorization input, not proof of identity.

## Domain guides

[Pricing](pricing.md), [budget authority](budget-authority.md), [ledger](ledger.md), [usage intake](usage-intake.md), [reporting](reporting.md), [prepared exports](prepared-exports.md), [evidence](evidence.md), [PostgreSQL evidence](evidence-postgres.md), [stored lineage](stored-lineage.md), [coverage-only reconciliation](reconciliation-coverage-v2.md), and [accounting](accounting.md) document source behavior and call limits. [Authorization and data handling](security.md) covers permissions and disclosure. The [CFO.ai handoff](cfo-ai-handoff.md) is manual; a prepared file is not delivery or acceptance.
