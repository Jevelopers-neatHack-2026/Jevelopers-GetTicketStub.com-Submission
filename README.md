# integration-evals

Cross-component verification and evidence.

## Implementation status

The repository now includes a typed verification CLI, inert fixtures, scenario oracles,
benchmark statistics, immutable reports, and offline CI. Integrated product and sponsor
acceptance remain unverified until canonical contracts, owner runners, exact composed
release pins, ratified datasets/policy, and authorized real evidence are supplied.

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

[Execution protocol and owner handoff](docs/execution-protocol.md) describes the manifest,
runner observations, isolation, evidence, benchmarks, reruns, and remaining obligations.

[Architecture reference](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [Implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)

## Architecture and delivery

- [Repository responsibilities and interfaces](docs/architecture/OWNERSHIP.md)
- [Relevant acceptance criteria](docs/architecture/ACCEPTANCE.md)
- [Architecture and diagrams](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md)
- [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md)

The original master acceptance JSON and Markdown remain unchanged. Local tooling results
do not verify their product criteria or establish connected sponsor tools or financial activity.
