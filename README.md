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
  <a href="#status"><img alt="Status: verification tooling; integrated acceptance pending" src="https://img.shields.io/badge/status-tooling%20candidate-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="planning/acceptance-checklist.md"><img alt="Acceptance checklist: 47 criteria, 3 verified" src="https://img.shields.io/badge/criteria-3%20of%2047%20verified-26302A?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [What's here](#whats-here) · [Docs](#docs) · [Related](#related-repositories)

## Status

This candidate includes a typed verification CLI, inert fixtures, scenario oracles,
benchmark statistics, immutable reports, and offline CI. Integrated product acceptance
remains incomplete until owner runners, exact composed release pins, ratified datasets
and policy, and authorized real evidence satisfy the required boundaries.

- SPN-01 (Neatlogs), SPN-02 (Entire) and SPN-03 (CFO.ai) are owner-accepted as recorded in the
  [master checklist](planning/acceptance-checklist.md) and [evidence index](evidence/README.md).
  The remaining 44 criteria are planned. These owner acceptances were relayed from chat;
  their chronology and artifact limitations remain in the dated records.
- Neatlogs evidence includes four screenshots and a curated owner/agent summary of
  reported research, agent and art runs. Exact trace/deployment bindings, malformed-art
  recovery, delivery cause and billing remain unverified. The later art screenshot shows
  model steps, tokens and timings; it does not close the complete IE-07 workflow or
  establish EVAL-02 comparable improvement. See the [qualified record](evidence/neatlogs/2026-10-11/README.md).
- Entire evidence covers one Claude checkpoint and repository graph snapshots. After the
  initial no-mirror record, the owner reported on 2026-10-11 that hosted mirrors for all
  10 code repos and `entire-checkpoints` were Synced, but the hosted Sessions view showed
  no transcript. Git-based retrieval remains the verified path. No Codex checkpoint is
  recorded, and the graph plugin version remains unpinned. See the chronological
  [checkpoint record](evidence/entire/2026-10-11/checkpoint.md).
- CFO.ai revision 2 is accepted with hypothetical forecasts; the authoritative Finance
  summary export, actual cash, demo coverage and submission remain open.
- The controlled private shared-contracts 0.9.7 consumer checks 86 versions across 76 names
  and 1,641 frozen fixture cases, with separate source and installed SDK receipts.
  [Private consumption instructions](docs/execution-protocol.md#canonical-candidate-conformance)
  describe exact package pins, readonly callers and the remaining owner boundaries.
- Local tooling and canonical contract checks do not establish complete integrated
  product acceptance. Missing assembly is reported as blocked.
- The broader [draft PR #23](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/23)
  remains on maintainer hold; merging accepted evidence into this candidate does not
  approve or release its verification tooling.
- Planned work is tracked in [IE-EPIC #1](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/1)
  and its linked IE issues, ending with the [IE-12 release gate](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/22).

## Run the tooling

Install Python 3.13 and uv, then:

```sh
uv sync --frozen
uv run integration-evals validate
uv run pytest
uv run basedpyright
uv run ruff check
uv run ruff format --check
uv run integration-evals run
```

Ruff checks project Python source and tests. Its five exact exclusions in `pyproject.toml`
are the dated CFO.ai capture scripts under `evidence/cfo-ai/2026-10-11/` and
`evidence/cfo-ai/2026-10-11-r2/`. These accepted evidence inputs remain byte-for-byte
unchanged and are covered by their `SHA256SUMS` manifests and recorded artifact/model
verification; formatting them would invalidate the accepted capture. No project source
or test file is excluded by this evidence exception.

The final command writes JSON, JUnit, coverage, Markdown, and a per-criterion release
audit under `reports/runs/<run-id>/`. Exit 2 means required product boundaries are
blocked; it is not a passing integration run. Offline tooling tests have their own
pass/fail result. The current fixture catalog contains 20 original synthetic inputs,
and the scenario registry contains 42 cases. The 12 benchmark rows are methodology
smoke data and cannot satisfy held-out sample requirements.

To execute actual composed boundaries, provide an app-owned manifest and clean pinned
component checkouts:

```sh
uv run integration-evals run --manifest /approved/release.json --workspace /approved/workspace
uv run integration-evals run --mode recorded --manifest /approved/release.json --workspace /approved/workspace
uv run integration-evals inspect reports/runs/<run-id>/run.json
uv run integration-evals benchmark benchmarks/corpus.json /approved/raw-samples.json
```

Sandbox/live modes require explicit current authority, credential presence, eligibility,
caps, permitted operations and cleanup. `--authorize-paid` is an execution confirmation
within existing owner authority, not a budget grant. No paid calls occur by default.
Provider modes and source origins are recorded separately.

[Print-invalid component verification](docs/print-component.md) documents the pinned
negative-only consumer and its required Linux runtime evidence.

[Execution protocol and owner handoff](docs/execution-protocol.md) describes the manifest,
runner observations, isolation, evidence, benchmarks, reruns, and remaining obligations.

## What's here

This repository owns reproducible evaluations across ownership boundaries: the customer journey, contract compatibility, recovery, artifact integrity and financial correctness. Repository-local tests stay with their implementations. See [ownership](docs/architecture/OWNERSHIP.md).

| Path | Purpose |
| --- | --- |
| [`planning/acceptance-checklist.md`](planning/acceptance-checklist.md) | Master acceptance criteria (ARC, CON, AGT, ART, FUL, FIN, BUD, DASH, EVAL, SPN, LIVE) with verify and evidence rules |
| [`planning/acceptance-checklist.json`](planning/acceptance-checklist.json) | Machine-readable tracker with acceptance states, evidence and tested revisions |
| [`planning/decisions/`](planning/decisions/) | Proposed owner decision memos (finance persistence, payment provider); none accepted |
| [`evidence/README.md`](evidence/README.md) | Index of planned evidence and dated owner-accepted sponsor records |
| [`docs/architecture/`](docs/architecture/OWNERSHIP.md) | [Ownership](docs/architecture/OWNERSHIP.md) and the [acceptance view](docs/architecture/ACCEPTANCE.md) for this repository |

Other repositories link their `docs/architecture/ACCEPTANCE.md` views to this checklist. Change criterion state here, and only after recording actual evidence and the tested revisions ([state rules](planning/acceptance-checklist.md#state-and-dependency-tracking)).

## Docs

- [Acceptance checklist](planning/acceptance-checklist.md) and [JSON tracker](planning/acceptance-checklist.json)
- [Evidence index](evidence/README.md)
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
