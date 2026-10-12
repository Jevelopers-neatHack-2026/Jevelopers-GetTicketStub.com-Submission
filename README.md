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
  <a href="planning/acceptance-checklist.md"><img alt="Acceptance checklist: 47 criteria, 3 sponsor criteria owner-accepted, 44 planned" src="https://img.shields.io/badge/criteria-3%20accepted%20%C2%B7%2044%20planned-26302A?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Run the tooling](#run-the-tooling) · [Configuration](#configuration) · [What's here](#whats-here) · [Docs](#docs) · [Related](#related-repositories)

## Status

This is incremental runner/SDK verification tooling: a typed CLI, inert fixtures, scenario
oracles (42 cases, 142 obligations), benchmark statistics, immutable reports and offline CI.
Its scope is the tooling only. Passing CI and review are not product proof. Integrated product
acceptance still needs owner runners, exact composed release pins, ratified datasets and
policy, and authorized real evidence. The producer release, adoption and product holds are
retained, and nothing here claims producer acceptance.

The `entire-graph` workflow runs on pushes to `main` and its intended weekly schedule. It has read-only repository permissions and uploads artifacts. Pull-request and manually selected-ref triggers are disabled, so it does not automatically publish generated instruction branches. Prepare instruction updates through a separate reviewed pull request.

Complete benchmark work in [issue #15](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/15)
and [issue #16](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/16) is
deferred until after deployment by explicit user instruction, as an initial-deployment
exception. Benchmark promotion stays blocked pending ratified evidence, and the 142
obligations, master checklist states and policy are unchanged.

The guarded print component test profile is merged in
[PR #40](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/40), with
revision-specific Linux execution and cleanup evidence. It is an explicit synthetic,
offline test profile; the older nested-Bubblewrap failures remain preserved. Production
CLI containment, ART-04 acceptance and the selected product journey remain separate gates.
See the [print component runbook](docs/print-component.md) for supported execution and limits.

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
- **CFO.ai revision 2 generic export:** the owner's sponsor acceptance of SPN-03 is not approval of the
  generic editable forecast export. Finance's latest `REQUEST_CHANGES` on
  [issue #20](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/20) leaves CFO-R2-001
  (a blank cash issue in that export) unresolved, so treat the generic export as not approved until it is closed.
- The shared owner confirmed (shared-contracts SC31, comment 6115337714) that the same immutable
  0.9.7 archive `d432ad5` (`771a9f5`) may be used for private offline development. That is not
  a release or adoption approval. The controlled private shared-contracts 0.9.7 consumer checks 86 versions across 76 names
  and 1,641 frozen fixture cases, with separate source and installed SDK receipts.
  [Private consumption instructions](docs/execution-protocol.md#canonical-candidate-conformance)
  describe exact package pins, readonly callers and the remaining owner boundaries.
- Local tooling and canonical contract checks do not establish complete integrated
  product acceptance. Missing assembly is reported as blocked.
- Accepting the owner decision memos does not grant any finance, payment or provider authority;
  see the Decisions section.
- [PR #23](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/23) merged the
  incremental runner/SDK tooling; [PR #51](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/51)
  connected evidence qualification and retained history to normal run reports. These merges
  do not approve any producer release, adoption or product claim.
- Captured Finance and Fulfillment component checks have their own pinned fixtures and
  scoped receipts. They do not execute the selected business journey or supply current
  host authority. Follow the [execution protocol](docs/execution-protocol.md) for each lane.
- The selected journey `mvp-20261012-ie-acceptance-01` remains **NOT_RUN** in the
  [release-gate record](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/22#issuecomment-6126761501):
  an accepted app-owned assembly, actual selected-run identity, owner grants and complete
  component/approval/provider evidence are still required. A green tooling run does not
  change that status.
- Planned work is tracked in [IE-EPIC #1](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/1)
  and its linked IE issues, ending with the [IE-12 release gate](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/22).

## Run the tooling

The package requires Python **3.13 or later**; [`.python-version`](.python-version)
pins development to **3.13.9**. Use uv and the committed [lockfile](uv.lock).
Component lanes additionally need the exact Node, Linux/container and producer pins in
their runbooks; those are not prerequisites for the standalone evidence audit below.

From a fresh clone:

```sh
git clone https://github.com/Jevelopers-neatHack-2026/integration-evals.git
cd integration-evals
uv sync --frozen
uv run integration-evals validate
uv run pytest
uv run basedpyright
uv run ruff check
uv run ruff format --check
```

To produce a report of the currently missing product assembly:

```sh
uv run integration-evals run
```

This command is expected to exit **2** while selected product boundaries are blocked.
Inspect the resulting report; do not count that exit as a passing integration check.

The standalone stdlib evidence-audit and rerun tools (`tools/`, `tests/test_audit_evidence.py`,
`tests/test_rerun_report.py`) are excluded from the strict package scope above and have their
own checks, which also run in CI. The stdlib ruff command names `tools` and the two test files
explicitly; do not run it with a bare `--config` over the whole tree, which would scan the
Python 3.13 package sources with the wrong rules:

```sh
uv run basedpyright -p pyrightconfig.stdlib.json
uv run ruff check --config ruff-stdlib.toml tools tests/test_audit_evidence.py tests/test_rerun_report.py
```

The workflow security regressions in `tests/test_entire_graph_workflow_security.py`
use Python 3.10+ annotations and receive the strict package checks above. They also
run as standalone stdlib unittests on Python 3.11 in the evidence-audit workflow.

Ruff checks project Python source and tests. Its five exact exclusions in `pyproject.toml`
are the dated CFO.ai capture scripts under `evidence/cfo-ai/2026-10-11/` and
`evidence/cfo-ai/2026-10-11-r2/`. These accepted evidence inputs remain byte-for-byte
unchanged and are covered by their `SHA256SUMS` manifests and recorded artifact/model
verification; formatting them would invalidate the accepted capture. No project source
or test file is excluded by this evidence exception.

The run command writes JSON, JUnit, coverage, Markdown, and a per-criterion release
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
uv run integration-evals inspect reports/runs/REPLACE_WITH_RUN_ID/run.json
uv run integration-evals benchmark benchmarks/corpus.json /approved/raw-samples.json
```

Use the actual directory printed by `run` in place of `REPLACE_WITH_RUN_ID`.

Sandbox/live modes require explicit current authority, credential presence, eligibility,
caps, permitted operations and cleanup. `--authorize-paid` is an execution confirmation
within existing owner authority, not a budget grant. No paid calls occur by default.
Provider modes and source origins are recorded separately.

[Execution protocol and owner handoff](docs/execution-protocol.md) describes the manifest,
runner observations, isolation, evidence, benchmarks, reruns, and remaining obligations.

## Configuration

No provider credentials are needed for fixture validation or the standalone integrity
checks. The CLI defaults to `mock-only` mode and reads configuration from repository files
and explicit options; it does not infer permission from a successful local test.

| Input | Purpose |
| --- | --- |
| [`fixtures/catalog.json`](fixtures/catalog.json) | Synthetic fixture identities, provenance and requirement links |
| [`scenarios/suite.json`](scenarios/suite.json) and [`selection.json`](scenarios/selection.json) | Scenario definitions and the selected cases |
| [`planning/requirements.json`](planning/requirements.json) | Frozen local requirement inventory alongside the master tracker |
| [`benchmarks/policy.json`](benchmarks/policy.json) | Benchmark methodology and promotion gates; smoke rows do not satisfy them |
| `--manifest /approved/release.json` | App-owned assembly with exact component and authority records |
| `--workspace /approved/workspace` | Clean component checkouts; defaults to the repository's parent directory |
| `--mode mock-only`, `recorded`, `sandbox` or `live` | Explicit execution mode with distinct evidence and authorization requirements |
| `--output reports/runs` | Destination for immutable run reports |

Keep host credentials in the owning runtime's protected configuration. A manifest,
`--authorize-paid`, a fixture key or an unsigned integrity digest is never an independent
grant of spending, provider, customer or publication authority.

### Decisions

[Decisions 0001 (finance persistence), 0002 (payment provider) and 0003](planning/decisions/) are recorded as **accepted (owner-delegated 2026-10-12)**, per the owner's session instruction as documented in 0003. Approving these memos did not execute any provisioning (no account creation, terms, key issuance, callback registration or provider call); owner-only actions remain. Live checkout stays disabled until LIVE-01 and launch approval. These memos set direction; they are not operational authority or verification.

### Evidence audit

[`docs/evidence-audit.md`](docs/evidence-audit.md) describes the evidence integrity audit. To run it from the repository root:

```sh
python3 tools/audit_evidence.py
python3 -m unittest -v tests.test_audit_evidence
python3 -m unittest -v tests.test_rerun_report
python3 -m unittest -v tests.test_entire_graph_workflow_security
```

These stdlib-only checks (Python 3.11+, no package install) run separately from the Python 3.13 package suite above (`uv run pytest`). They check evidence integrity (for example, files and checksums) and workflow trust configuration. They do not promote any criterion to accepted or verified and are not acceptance evidence.

### Continuous integration

The [verification workflow](.github/workflows/verification.yml) covers package tooling,
canonical compatibility and the configured component lanes.
[Evidence audit](.github/workflows/evidence-audit.yml) and
[rerun report](.github/workflows/rerun-report.yml) have separate path-filtered stdlib jobs.
Other [workflows](.github/workflows/) retain their own producer/runtime pins and execution
boundaries. A workflow result applies to its tested revision, selected lane and artifacts;
it is not a blanket acceptance result for every component or later commit.

## What's here

This repository owns reproducible evaluations across ownership boundaries: the customer journey, contract compatibility, recovery, artifact integrity and financial correctness. Repository-local tests stay with their implementations. See [ownership](docs/architecture/OWNERSHIP.md).

| Path | Purpose |
| --- | --- |
| [`planning/acceptance-checklist.md`](planning/acceptance-checklist.md) | Master acceptance criteria (ARC, CON, AGT, ART, FUL, FIN, BUD, DASH, EVAL, SPN, LIVE) with verify and evidence rules |
| [`planning/acceptance-checklist.json`](planning/acceptance-checklist.json) | Machine-readable tracker: 3 owner-accepted sponsor criteria with evidence and revision refs; the rest planned and empty |
| [`planning/decisions/`](planning/decisions/) | Owner decision memos 0001-0003, accepted (owner-delegated 2026-10-12); nothing executed |
| [`evidence/README.md`](evidence/README.md) | Index of submission evidence: three sponsor records plus planned entries |
| [`docs/architecture/`](docs/architecture/OWNERSHIP.md) | [Ownership](docs/architecture/OWNERSHIP.md) and the [acceptance view](docs/architecture/ACCEPTANCE.md) for this repository |
| [`src/integration_evals/`](src/integration_evals/) | CLI, schemas, execution boundaries, immutable reporting and evidence qualification |
| [`tests/`](tests/) and [`integration_tests/`](integration_tests/) | Tooling regressions and composed checks; required runtime/context varies by suite |
| [`component_tests/`](component_tests/) | Pinned retrieval and print test profiles |
| [`finance_component_tests/`](finance_component_tests/), [`fulfillment_component_tests/`](fulfillment_component_tests/) and [`app_recovery_component_tests/`](app_recovery_component_tests/) | Independently scoped component/captured-fixture lanes |
| [`tools/`](tools/) | Standalone evidence-integrity and retained-rerun utilities |

The application supplies the assembly; this repository validates the chosen boundaries,
captures observations and joins them to requirements and evidence. Producer repositories
retain their runtime, authorization and domain responsibilities. Historical captures and
their checksum manifests are immutable inputs, not current release claims.

Other repositories link their `docs/architecture/ACCEPTANCE.md` views to this checklist. Change criterion state here, and only after recording actual evidence and the tested revisions ([state rules](planning/acceptance-checklist.md#state-and-dependency-tracking)).

## Docs

- [Acceptance checklist](planning/acceptance-checklist.md) and [JSON tracker](planning/acceptance-checklist.json)
- [Evidence index](evidence/README.md) · [Evidence audit](docs/evidence-audit.md)
- [Evaluator evidence index and local reviews](docs/evidence-index.md)
- [Preserved runner history and safe evaluation diagnostics](docs/safe-reruns-runner.md)
- [Ownership](docs/architecture/OWNERSHIP.md) · [Acceptance view](docs/architecture/ACCEPTANCE.md)
- [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Acceptance evidence standard](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/standards/acceptance-evidence.md)

## Related repositories

- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): assembles the pinned integration workspace these evaluations run against.
- [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts): compatibility fixtures for contract checks.
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): expected money behavior for financial scenarios.
- [marketing-material](https://github.com/Jevelopers-neatHack-2026/marketing-material): consumes reviewed evidence.

## Contributing

Follow [AGENTS.md](AGENTS.md) and the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Use synthetic or approved fixtures and publish only sanitized evidence. Never fabricate component pins or financial outcomes. Preserve historical captures, their hashes and acceptance chronology. Use a focused branch, neutral issue references and independent review of the exact documentation diff.

## License

No repository license file is present. Component packages and retained evidence keep
their own provenance and applicable terms; do not infer a project-wide license.
