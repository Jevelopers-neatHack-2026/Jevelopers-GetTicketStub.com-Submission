# team-dashboard responsibility and current boundary

**Repository role:** Isolated React/Vite library for an administrative finance dashboard. **Accountable role:** Finance and reliability. **Observed source:** main at `97e35e7f669f368b26c9884c48e7c181a26438b8`, audited 2026-10-12.

## Responsibility

Own the dashboard presentation and typed consumer boundary for financial summaries, filters, reports and detail views. The package does not own the host's identity, session, membership or application routing. It does not own the authoritative ledger, pricing, reconciliation or finance command writes; those remain with their service owners. Browser projections are display data, never credentials or authority.

The current library entry points are src/index.ts and src/server.ts. UI routes and views are in src/Dashboard.tsx, src/views/ and src/reports/; data and trust boundaries are in src/data/ and src/access/; reusable controls are in src/components/; local styles and the scoped brand-token subset are in src/styles.css and src/styles/brand-tokens.css. Finance v2 ports, synthetic fixtures and validation are under src/views/finance-v2/. Package, contract, integration and test configuration are maintained in the root manifests and contracts/, integration/, and tests/.

## Current host and data boundary

The host-side /admin route currently renders its own staff-gated fixture. The main application does not import or run this package, and this package's host integration check remains blocked pending real host wiring and acceptance. Team Dashboard's local host verifier and offline HMAC test double prove package-side validation behavior only; they do not prove the host's production session verifier, runtime mount, finance backend or cross-repository conformance.

The integration notes describe a proposed seam and retain source-specific decisions. Read each note's source pin and status before applying it. Host /2 context grants and a provider-agnostic verifier do not amount to an approved end-to-end finance contract. Financial data fixtures are synthetic and should remain visibly distinct from live or reconciled data.

## Scope and ownership

- Dashboard components, route presentation, query/filter behavior, evidence labels, empty/error states and export presentation belong here.
- Identity, authentication, role membership, session revocation and trusted scope must be supplied and verified by the host server; a client-side HostAccess object is not authority.
- Financial totals, billing mode, ledger rows and command effects come from their owning services through a reviewed host adapter; the dashboard must not silently recalculate an authoritative figure from incomplete fixture data.
- Brand tokens in this repository are a local scoped subset; do not claim full brand-kit publication, rights or version conformance from their presence.
- Master integration acceptance and issue state remain owned by integration-evals and the relevant live issues.

## Validation and contributor handoff

Use the repository's pinned Node/npm toolchain and commands defined in package.json and docs/development.md. Unit, contract, browser and build checks cover different local properties; none by itself accepts the host mount, production verifier, finance source or external command path. Keep trust-boundary and fixture distinctions intact when editing examples. Preserve AGENTS.md, CLAUDE.md, security policy and local contributor obligations.

## Architecture and acceptance sources

- [Current host architecture and integration state](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) (available after the companion documentation PR merges).
- [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md): dated design intent, not current implementation.
- [Local acceptance view](ACCEPTANCE.md) and the [master integration-evals checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/56018576a9450a2bb46aa55ed3b2f9d9ae97e50d/planning/acceptance-checklist.md).
- [Team Dashboard development guide](../development.md) and [organization contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md).
