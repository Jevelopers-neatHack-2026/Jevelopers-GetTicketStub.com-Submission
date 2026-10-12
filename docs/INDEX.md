# Documentation index

This package is a host-composed finance library, not a hosted service. PostgreSQL behavior requires injected authority, trusted context and storage; local tests do not establish finance acceptance or consumer adoption.

## Development and boundaries
- [Development guide](development.md) lists the Node/npm toolchain, offline commands, Docker-backed suites and database lifecycle.
- [API map](api/INDEX.md) summarizes implemented, partial and typed-unavailable operations.
- [Authorization and data handling](api/security.md) describes operation permissions, data classes, PostgreSQL roles and disclosure boundaries.
- [Compatibility](api/compatibility.md) and [canonical compatibility](api/canonical-compatibility.md) distinguish local wrappers from the proposal-only shared contract.

## Domain APIs
- [Usage intake](api/usage-intake.md), [pricing](api/pricing.md), and [ledger](api/ledger.md) cover measured usage, estimates and postings.
- [Budget authority](api/budget-authority.md) identifies working reservation operations and unavailable settlement/finality paths.
- [Reporting](api/reporting.md) covers scoped queries and snapshots. [Prepared exports](api/prepared-exports.md) describe local artifact preparation, not external delivery. The [partition-binding verifier](api/partition-binding.md) is a reporting-subpath interface with an `isolated_fixture` source adapter; its default is typed `unavailable`, and an observation supplies no read, export or provisioning authority.
- [CFO.ai handoff](api/cfo-ai-handoff.md) is manual and distinguishes a prepared file from verified evidence and a completed plan update.
- [Evidence](api/evidence.md), [PostgreSQL evidence reader](api/evidence-postgres.md), [stored lineage](api/stored-lineage.md), and [accounting](api/accounting.md) cover bounded reference and lineage reads. [Coverage-only reconciliation](api/reconciliation-coverage-v2.md) stores and reads source-coverage metadata; full financial reconciliation remains unavailable.

See [ownership](architecture/OWNERSHIP.md) and [acceptance allocation](architecture/ACCEPTANCE.md); the master tracker owns current status.
