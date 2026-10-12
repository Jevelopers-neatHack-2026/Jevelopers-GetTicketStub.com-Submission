# Ownership and integration boundary

**Repository:** Public GitHub repository, checked 2026-10-12.

**Owner role:** Finance and reliability; named assignee and reviewer remain kickoff decisions.

**Current delivery state:** Main contains an incremental evaluator CLI, pinned assembly and component-runner tooling, scenario and fixture validation, evidence indexing and integrity checks, rerun/replay diagnostics, benchmark tooling, and focused development-consumer checks. This is verification tooling, not an implementation of the application services it exercises.

## Responsibility

Own reproducible cross-component evaluations and the evidence used to assess delivery claims. The evaluator covers customer journeys, contract compatibility, recovery, artifact integrity, and financial correctness across repository boundaries. Product behavior remains with its owning repository. Use synthetic or approved fixtures, record tested revisions and modes, and preserve exact source and evidence references.

`src/integration_evals/` defines evaluator records and commands. The JSON Schemas under `schemas/` are generated from those Python models by `src/integration_evals/schema_exports.py`; they describe evaluator records and do not replace product contracts. Product contract ownership stays with `shared-contracts`. The `component_tests/` and `*_component_tests/` lanes exercise bounded, pinned owner interfaces; a component result is limited to its stated fixtures and selection and does not establish composed product acceptance.

## Current acceptance boundary

The master checklist and its JSON tracker at integration-evals revision [`56018576a9450a2bb46aa55ed3b2f9d9ae97e50d`](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/56018576a9450a2bb46aa55ed3b2f9d9ae97e50d/planning) are authoritative. In that snapshot, SPN-01, SPN-02, and SPN-03 are owner-accepted against their dated evidence records; the other 44 criteria remain planned. Each sponsor record has explicit evidence limitations, and none establishes general provider adoption or integrated product acceptance. See the [acceptance view](ACCEPTANCE.md) and [evidence index](../../evidence/README.md) before repeating a claim.

Passing evaluator CI, a component slice, a benchmark smoke run, or an integrity audit is not product proof. A release claim still needs exact composed component pins, complete required owner-run evidence, ratified datasets and policy, and authorized real evidence. The user's initial-deployment deferral for JEV benchmark work is recorded in issues [#15](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/15), [#16](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/16), and the [#22 release-gate exception](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/22); those issues remain open and unverified, and the deferral does not establish EVAL-02 or benchmark promotion.

## Dependencies and handoff

Run composed evaluations only against the app-owned, pinned integration workspace assembled by `getticketstub.com`. Coordinate product contract compatibility with `shared-contracts` and expected money behavior with `cost-intelligence`. Keep repository-local tests with their implementations. Supply sanitized, reviewable evidence to intended consumers; distinguish development provenance, runtime observations, financial scenarios, and product acceptance.

## Historical architecture material

The [Architecture Kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) is a dated planning snapshot. Treat it as historical intent, not a report of current implementation. For current behavior, inspect the tested source revisions and the dated evidence referenced by the master checklist. The organization is preparing a maintained current-state companion; this repository does not establish a competing architecture source.

## Contributor handoff

Use the repository [acceptance view](ACCEPTANCE.md), the pinned master checklist, and the central implementation plan. Preserve acceptance authority and owner roles. Follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md); use only synthetic or approved fixtures and publish only sanitized evidence. Never fabricate component pins or financial outcomes.
