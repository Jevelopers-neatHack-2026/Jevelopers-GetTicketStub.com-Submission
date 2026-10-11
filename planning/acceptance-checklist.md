# Acceptance Checklist

All requirements start **planned**. These are team engineering criteria, not quotations of competition rules. Mark an item verified only after recording actual evidence and the tested revisions. A deferred P0 item is an explicit scope exception, not verification.

**Priorities:** P0 = demonstration and financial integrity; P1 = next expansion; Production = before enabling live commerce.

**Owner roles:** Product and frontend; Agent and research; Creative and fulfillment; Finance and reliability.

The matching [JSON tracker](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.json) carries empty evidence and revision fields for completion records. Official event requirements and source links are in [architecture section 11](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md#11-hackathon-requirements-and-evidence).

## Architecture

### ARC-01 Pinned clean assembly

- [ ] **Planned** | P0 | Product and frontend
- **Verify:** Build the chosen revisions from a clean workspace using the documented bootstrap and dependency lockfile.
- **Evidence:** Release manifest, runtime versions and successful command output.

### ARC-02 Single data ownership

- [ ] **Planned** | P0 | Product and frontend
- **Verify:** Trace each core record and migration to one owner; consumers use documented interfaces.
- **Evidence:** Data ownership map and integrated write-path review.


## Contracts

### CON-01 Contract compatibility

- [ ] **Planned** | P0 | Agent and research
- **Verify:** Run valid, invalid, older-version and unknown-field fixtures against producers and consumers.
- **Evidence:** Versioned fixtures and compatibility results.

### CON-02 Trusted scope and identity

- [ ] **Planned** | P0 | Agent and research
- **Verify:** Supply forged tenant and project IDs and confirm the server rejects unauthorized scope.
- **Evidence:** Negative authorization cases across API, jobs and artifacts.

### CON-03 Typed bounded actions

- [ ] **Planned** | P0 | Agent and research
- **Verify:** Reject unknown dynamic controls, privileged actions and unsupported contract versions.
- **Evidence:** Validation errors and allowlisted control fixtures.


## Agent and research

### AGT-01 Sourced event facts

- [ ] **Planned** | P0 | Agent and research
- **Verify:** Research the selected URL and attach a source or explicit uncertainty to each material fact.
- **Evidence:** Event package with field-level provenance and conflicts.

### AGT-02 Durable resume

- [ ] **Planned** | P0 | Agent and research
- **Verify:** Interrupt the worker after a completed step and resume from its saved checkpoint.
- **Evidence:** Before and after checkpoints and correlated traces.

### AGT-03 Bounded recovery

- [ ] **Planned** | P0 | Agent and research
- **Verify:** Trigger a recoverable failure and show attempts, elapsed time and cost limits terminate or resolve it.
- **Evidence:** Run showing failure, next action and final outcome.

### AGT-04 Untrusted content handling

- [ ] **Planned** | P0 | Agent and research
- **Verify:** Retrieve a page containing instructions to change budgets or tool permissions and confirm they are not acted upon.
- **Evidence:** Adversarial source fixture and permission outcome.

### AGT-05 Safe URL retrieval

- [ ] **Planned** | P0 | Agent and research
- **Verify:** Reject private-network and unsupported destinations, including a redirected destination.
- **Evidence:** URL validation and resource-limit results.


## Artwork and production

### ART-01 Versioned design edits

- [ ] **Planned** | P0 | Creative and fulfillment
- **Verify:** Create a design and one revision with separate hashes, parent linkage and usage references.
- **Evidence:** Two design records and a visible comparison.

### ART-02 Approval binds exact output

- [ ] **Planned** | P0 | Product and frontend
- **Verify:** Approve one version then change its artwork or event facts; require a new approval.
- **Evidence:** Approval binding and stale-version rejection.

### ART-03 Deterministic personalization

- [ ] **Planned** | P0 | Creative and fulfillment
- **Verify:** Render multiple names using the selected template and verify exact text and font availability.
- **Evidence:** Output variants and content-integrity report.

### ART-04 Print preflight and hashes

- [ ] **Planned** | P0 | Creative and fulfillment
- **Verify:** Reject invalid dimensions, bleed or resolution; accept a matching bundle and verify all file hashes.
- **Evidence:** Product specification, preflight report and manifest.

### ART-05 Approved asset inputs

- [ ] **Planned** | P0 | Creative and fulfillment
- **Verify:** Use only assets with the required approval record in the production bundle.
- **Evidence:** Asset provenance and approval references.


## Fulfillment

### FUL-01 Quote separated from purchase

- [ ] **Planned** | P0 | Creative and fulfillment
- **Verify:** Obtain a sandbox quote and show it does not create an incurred expense or submitted order.
- **Evidence:** Quote record, order state and ledger comparison.

### FUL-02 Purchase authorization integrity

- [ ] **Planned** | P0 | Creative and fulfillment
- **Verify:** Change quantity, destination, bundle hash, currency or authorized amount and reject the stale authorization.
- **Evidence:** Authorization record and invalidation cases.

### FUL-03 Ambiguous submission recovery

- [ ] **Planned** | P0 | Creative and fulfillment
- **Verify:** Simulate supplier acceptance followed by timeout; resolve its existing identity before any resubmission.
- **Evidence:** Attempt history showing one intended supplier order.

### FUL-04 Duplicate supplier callback

- [ ] **Planned** | P0 | Creative and fulfillment
- **Verify:** Replay the same status notification and confirm no second commercial transition or charge.
- **Evidence:** Inbox identity and unchanged effective records.


## Financial integrity

### FIN-01 Attempt level metering

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Join every billable attempt to provider, model, usage, budget scope and correlation ID, or explicit incomplete data.
- **Evidence:** Usage-to-attempt report and missing-data coverage.

### FIN-02 Duplicate observations

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Import matching direct usage and trace observations twice; effective expense remains one charge.
- **Evidence:** Source identity mapping and unchanged ledger totals.

### FIN-03 Distinct billed retries

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Execute two distinct billable attempts for one logical operation and retain both costs.
- **Evidence:** Two attempt identities with attributed usage.

### FIN-04 Unknown billing

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Remove provider usage or time out after dispatch; retain unknown or estimated cost instead of an invented zero.
- **Evidence:** Incomplete record, held budget and reconciliation status.

### FIN-05 Estimate reconciliation

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Reconcile a $1.00 estimate with a $1.10 confirmed cost; effective spend is $1.10 with traceable adjustment.
- **Evidence:** Linked postings and reconciliation evidence.

### FIN-06 Aggregate billing coverage

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Import an invoice covering existing request costs without adding those costs again; retain unexplained differences.
- **Evidence:** Coverage mapping and unallocated discrepancy record.

### FIN-07 Subcent usage precision

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Accumulate small per-call costs without rounding each call to zero.
- **Evidence:** Exact intermediate amounts and documented final rounding.

### FIN-08 Shared research allocation

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Allocate one research expense across several orders without increasing project expense.
- **Evidence:** Original posting and analytical allocation totals.

### FIN-09 Revenue and cash classification

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Apply a sale, fee, refund, tax amount, credit, payout and reimbursement with their defined distinct effects.
- **Evidence:** Deterministic ledger fixture and expected projections.

### FIN-10 Billing mode isolation

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Mix live paid AI tests and simulated sales; actual costs include the paid call while real revenue excludes simulations.
- **Evidence:** Filtered projections and source billing modes.


## Budget controls

### BUD-01 Concurrent project reservations

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Compete for the remaining capacity from two workers and reject any reservation that exceeds the shared limit.
- **Evidence:** Concurrent reservation result and conserved capacity.

### BUD-02 Reservation consumption

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Settle a held amount into spend and release only its unused portion.
- **Evidence:** Before and after budget projection and posting links.

### BUD-03 Uncertain in flight cost

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Expire a worker lease during an unresolved provider call and retain the conservative financial hold.
- **Evidence:** Lease state, hold state and reconciliation path.

### BUD-04 Nested budget scopes

- [ ] **Planned** | P1 | Finance and reliability
- **Verify:** Check project, workstream, agent and task limits atomically before dispatch.
- **Evidence:** Multi-scope contention and settlement results.


## Dashboard

### DASH-01 Reproducible aggregates

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Open a displayed total and verify its records match the selected period, currency and billing mode.
- **Evidence:** Dashboard drilldown and backend projection comparison.

### DASH-02 Data quality visibility

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Display absent cash data, estimated costs and unreconciled differences clearly.
- **Evidence:** Screenshots showing unknown, estimated and confirmed cases.

### DASH-03 Role enforced commands

- [ ] **Planned** | P0 | Product and frontend
- **Verify:** Allow member reads while restricting budget and expense commands to authorized roles; record changes.
- **Evidence:** Server authorization cases and actor audit history.

### DASH-04 CFO summary provenance

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Export a versioned financial summary with definitions, period, assumptions, coverage and source references.
- **Evidence:** Export artifact reconciled to the financial projection.


## Evidence and release

### EVAL-01 Complete customer journey

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Run URL research through revision, approval, export, sandbox fulfillment and financial reporting.
- **Evidence:** One correlated scenario with pinned component revisions.

### EVAL-02 Comparable improvement

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Evaluate the same representative inputs before and after one change with cost, latency and success criteria.
- **Evidence:** Raw results, sample size and configuration differences.

### EVAL-03 Evidence classification

- [ ] **Planned** | P0 | Product and frontend
- **Verify:** Label simulated, sandbox, live, estimated and pending capabilities next to the related demo claims.
- **Evidence:** Sanitized evidence index and reviewed narrative.

### EVAL-04 Secrets and customer data

- [ ] **Planned** | P0 | Finance and reliability
- **Verify:** Review published evidence and repository history for credentials and unnecessary customer or account details.
- **Evidence:** Sanitization review and applicable scanning results.


## Sponsor evidence

### SPN-01 Neatlogs use

- [x] **Verified** 2026-10-11 (owner-accepted) | P0 | Finance and reliability
- **Verify:** Record an actual agent run in Neatlogs and provide inspectable traces or sanitized screenshots.
- **Evidence:** Neatlogs artifact tied to an evaluated application run.
- **Recorded evidence:** [Original TicketStub Neatlogs record](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/d9be4d1832a7d0f713cf8494eb5df0e59d94ec89/evidence/neatlogs/2026-10-11) at integration-evals `d9be4d1`; see the [qualified record](../evidence/neatlogs/2026-10-11/README.md). Owner (Finance and reliability: CompleteDotTech) accepted 2026-10-11 by explicit chat instruction ("I approve") relayed by an agent via PR #33; that chronology is preserved. Three screenshots show research success/timeout and agent reply with span types varying by example; the curated owner/agent summary supplies exact IDs/times, reported production getticketstub.com `e4a1993`/runtime binding, HTTP 422 and summary-only art recovery. Raw backend/host receipts are absent. Three of seven sessions were not found in the reported readback window; a once-only acceptance diagnostic establishes at least one reported success, with no per-export counters/ACK joins and unresolved client/server/finalization cause or permanent storage outcome. Procedural fallback is reported only for observed art requests. Provider cost is exported when supplied, otherwise absent/unknown; dashboard costs and no-further-spend reports are not verified billing. No before/after improvement (EVAL-02) or durable harness integration is established.

### SPN-02 Entire use

- [x] **Verified** 2026-10-11 (owner-accepted) | P0 | Agent and research
- **Verify:** Capture actual Entire development provenance through checkpoints or repository graph output.
- **Evidence:** Entire artifact linked to relevant component revisions.

### SPN-03 CFO.ai use

- [x] **Verified** 2026-10-11 (owner-accepted) | P0 | Finance and reliability
- **Verify:** Build the business plan in CFO.ai using the financial summary and documented assumptions.
- **Evidence:** CFO.ai plan covering pricing, costs, revenue and runway; a generic data export alone is insufficient.
- **Recorded evidence:** [CFO.ai plan revision 2](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/6420af494a5276f69c337f47dac3ad4c1854d524/evidence/cfo-ai/2026-10-11-r2) at integration-evals `6420af4`; [verification](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/6420af494a5276f69c337f47dac3ad4c1854d524/evidence/cfo-ai/2026-10-11-r2/VERIFICATION.md). Forecasts are hypothetical; the authoritative Finance summary export (cost-intelligence#3), actual cash, demo coverage and submission remain open.


## Production launch

### LIVE-01 Live payment event handling

- [ ] **Planned** | Production | Product and frontend
- **Verify:** Verify payment signatures, repeated and reordered events, refunds and refund allocation before live checkout.
- **Evidence:** Payment sandbox suite, reconciliation and launch review.

### LIVE-02 Operational recovery

- [ ] **Planned** | Production | Product and frontend
- **Verify:** Restore database and artifacts, rehearse interrupted deployment recovery, and verify monitoring ownership.
- **Evidence:** Restore record, recovery procedure and alert ownership.

### LIVE-03 Live supplier validation

- [ ] **Planned** | Production | Creative and fulfillment
- **Verify:** Validate the actual SKU and authorization process before enabling a live purchase.
- **Evidence:** Approved sample, confirmed product specification and launch decision.

## State and dependency tracking

Allowed states: `planned`, `in_progress`, `blocked`, `verified`, `deferred`. Record an actual verification result, evidence references and tested revisions before moving to verified. Use blocked for a concrete missing prerequisite; preserve failed runs in evidence. The JSON tracker retains original IDs, owner roles, priority, verification and evidence requirements. Dependencies begin unassigned and must be recorded when work is scoped; work-package dependency links are maintained in the central implementation plan and implementation issues.
