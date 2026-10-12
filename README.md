<a href="https://github.com/Jevelopers-neatHack-2026/integration-evals">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="integration-evals — Cross-component verification and evidence. TicketStub banner showing small stubs joined at perforations along a common checkpoint line." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# integration-evals

Cross-component verification for TicketStub, and the home of the master acceptance checklist and its evidence index.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: documentation and evidence baseline, no cross-repository evaluator on main" src="https://img.shields.io/badge/status-docs%20%2B%20evidence-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="planning/acceptance-checklist.md"><img alt="Acceptance checklist: 47 criteria, 3 sponsor criteria owner-accepted, 44 planned" src="https://img.shields.io/badge/criteria-3%20accepted%20%C2%B7%2044%20planned-26302A?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [What's here](#whats-here) · [Docs](#docs) · [Related](#related-repositories)

## Status

**Docs and evidence baseline.** `main` contains planning documents and dated evidence records, the manual [`entire-graph` workflow](.github/workflows/entire-graph.yml), and the Python scripts that accompany the CFO.ai evidence (model, export verification, Excel recalculation check). It has no cross-repository evaluator, scenario runner or fixtures, and no package to install.

- The [JSON tracker](planning/acceptance-checklist.json) on `main` has 47 criteria: **3 `verified`** (the sponsor criteria SPN-01, SPN-02 and SPN-03, each owner-accepted on 2026-10-11 by CompleteDotTech via chat instruction relayed by an agent; canonical owner roles are Finance and reliability for SPN-01 and SPN-03, and Agent and research for SPN-02) and **44 `planned`**. No other criterion has implementation evidence, and this does not verify the product.
- Each acceptance carries qualifications that are kept in the tracker notes and the [evidence index](evidence/README.md): Neatlogs traces are owner-reported and curated, with raw backend receipts absent (SPN-01); Entire has one Claude checkpoint plus graph snapshots, with local capture removed and the graph plugin version unpinned (SPN-02); CFO.ai figures are hypothetical forecasts with no actual revenue, and the Finance summary export and submission remain open (SPN-03).
- **CFO.ai revision 2 generic export:** the owner's sponsor acceptance of SPN-03 is not approval of the generic editable forecast export. Finance's latest `REQUEST_CHANGES` on [issue #20](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/20) leaves CFO-R2-001 (a blank cash issue in that export) unresolved, so treat the generic export as not approved until it is closed.
- Evidence artifacts on `main`: [Neatlogs trace record](evidence/neatlogs/2026-10-11/README.md), [Entire checkpoint and entire-graph snapshots](evidence/entire/2026-10-11/README.md) (the `entire graph` workflow is described there; snapshots come from per-repository GitHub Actions at exact `main` commits), and the CFO.ai plan ([revision 2](evidence/cfo-ai/2026-10-11-r2/README.md), [original](evidence/cfo-ai/2026-10-11/README.md)).
- Not merged: [draft PR #23](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/23) would add pinned integration verification tooling, including a cross-repository evaluator. It is a draft, and nothing from it is acceptance evidence for `main`.
- Planned work is tracked in [IE-EPIC #1](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/1) and its linked IE issues, ending with the [IE-12 release gate](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/22).

### Decisions

[Decisions 0001 (finance persistence), 0002 (payment provider) and 0003](planning/decisions/) are recorded as **accepted (owner-delegated 2026-10-12)**, per the owner's session instruction as documented in 0003. Approving these memos did not execute any provisioning (no account creation, terms, key issuance, callback registration or provider call); owner-only actions remain. Live checkout stays disabled until LIVE-01 and launch approval. These memos set direction; they are not operational authority or verification.

### Evidence audit

[`docs/evidence-audit.md`](docs/evidence-audit.md) describes the evidence integrity audit. To run it from the repository root:

```sh
python3 tools/audit_evidence.py
python3 -m unittest discover -s tests
```

The audit ships in the same change as this documentation. These checks cover evidence **integrity only** (for example, files and checksums). They do not promote any criterion to accepted or verified and are not acceptance evidence.

## What's here

This repository owns reproducible evaluations across ownership boundaries: the customer journey, contract compatibility, recovery, artifact integrity and financial correctness. Repository-local tests stay with their implementations. See [ownership](docs/architecture/OWNERSHIP.md).

| Path | Purpose |
| --- | --- |
| [`planning/acceptance-checklist.md`](planning/acceptance-checklist.md) | Master acceptance criteria (ARC, CON, AGT, ART, FUL, FIN, BUD, DASH, EVAL, SPN, LIVE) with verify and evidence rules |
| [`planning/acceptance-checklist.json`](planning/acceptance-checklist.json) | Machine-readable tracker: 3 owner-accepted sponsor criteria with evidence and revision refs; the rest planned and empty |
| [`planning/decisions/`](planning/decisions/) | Owner decision memos 0001-0003, accepted (owner-delegated 2026-10-12); nothing executed |
| [`evidence/README.md`](evidence/README.md) | Index of submission evidence: three sponsor records plus planned entries |
| [`docs/architecture/`](docs/architecture/OWNERSHIP.md) | [Ownership](docs/architecture/OWNERSHIP.md) and the [acceptance view](docs/architecture/ACCEPTANCE.md) for this repository |

Other repositories link their `docs/architecture/ACCEPTANCE.md` views to this checklist. Change criterion state here, and only after recording actual evidence and the tested revisions ([state rules](planning/acceptance-checklist.md#state-and-dependency-tracking)).

## Docs

- [Acceptance checklist](planning/acceptance-checklist.md) and [JSON tracker](planning/acceptance-checklist.json)
- [Evidence index](evidence/README.md) · [Evidence audit](docs/evidence-audit.md)
- [Ownership](docs/architecture/OWNERSHIP.md) · [Acceptance view](docs/architecture/ACCEPTANCE.md)
- [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Acceptance evidence standard](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/standards/acceptance-evidence.md)

## Related repositories

- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): assembles the pinned integration workspace these evaluations run against.
- [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts): compatibility fixtures for contract checks.
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): expected money behavior for financial scenarios.
- [marketing-material](https://github.com/Jevelopers-neatHack-2026/marketing-material): consumes reviewed evidence.

## Contributing

Follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Use synthetic or approved fixtures and publish only sanitized evidence. Never fabricate component pins or financial outcomes. No license file is present in this repository.
