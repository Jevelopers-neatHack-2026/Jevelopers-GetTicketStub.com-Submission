"""Public command surface for offline validation and explicitly gated owner execution."""

import os
import subprocess
from collections.abc import Callable
from functools import wraps
from pathlib import Path
from typing import Annotated

import typer
from pydantic import TypeAdapter, ValidationError

from integration_evals import evidence_cli, history_cli, schema_exports
from integration_evals.artifacts import load_record, read_bytes
from integration_evals.benchmarks import (
    Corpus,
    Sample,
    paired_family_interval,
    summarize,
    validate_corpus,
)
from integration_evals.comparison_archive import save_comparisons
from integration_evals.contract_package import InstalledPackage
from integration_evals.contract_records import ContractPin, ContractRuntime
from integration_evals.contracts import (
    ContractSettings,
    execute_contracts,
    runtime_digest,
    save_contract_receipt,
)
from integration_evals.diagnostics import replay_comparisons
from integration_evals.errors import InvalidArtifactError
from integration_evals.evidence_index import EvidenceIndex
from integration_evals.execution import Settings
from integration_evals.history import History
from integration_evals.history_archive import save_history
from integration_evals.models import (
    Catalog,
    Mode,
    RequirementId,
    Run,
    Selection,
    Suite,
)
from integration_evals.policy import Policy, policy_blockers, promotion
from integration_evals.release import audit, export_audit
from integration_evals.report_validation import validate_evidence, validate_run
from integration_evals.reporting import (
    Tracker,
)
from integration_evals.runner import execute_captured
from integration_evals.specifications import (
    Requirements,
    generate_corpus,
    generate_fixtures,
    import_requirements,
)
from integration_evals.validation import validate_catalog, validate_suite

app = typer.Typer(no_args_is_help=True)


def safe_command[**Parameters, Result](
    command: Callable[Parameters, Result],
) -> Callable[Parameters, Result]:
    """Keep malformed external records and private paths out of public CLI diagnostics."""

    @wraps(command)
    def invoke(*args: Parameters.args, **kwargs: Parameters.kwargs) -> Result:
        try:
            return command(*args, **kwargs)
        except InvalidArtifactError as error:
            typer.echo(f"Evaluation rejected: {error.code}", err=True)
            raise typer.Exit(1) from None
        except (ValidationError, OSError, subprocess.SubprocessError) as error:
            typer.echo(f"Evaluation input/runtime rejected: {type(error).__name__}", err=True)
            raise typer.Exit(1) from None

    return invoke


def owned_requirements(repository: Path) -> frozenset[RequirementId]:
    """Join the unchanged master IDs with exact frozen local leaf criteria."""
    tracker = load_record(repository / "planning/acceptance-checklist.json", Tracker)
    local = load_record(repository / "planning/requirements.json", Requirements)
    return frozenset(
        (*[criterion.id for criterion in tracker.criteria], *[leaf.id for leaf in local.leaves])
    )


@app.command()
@safe_command
def initialize(repository: Path, backlog: Path) -> None:
    """Generate original synthetic inputs and import an externally captured issue inventory."""
    (repository / "fixtures").mkdir(exist_ok=True)
    (repository / "benchmarks").mkdir(exist_ok=True)
    _ = import_requirements(backlog, repository / "planning/requirements.json")
    catalog = generate_fixtures(repository / "fixtures")
    corpus = generate_corpus(repository / "benchmarks/corpus.json")
    typer.echo(
        f"Generated {len(catalog.fixtures)} synthetic fixtures; {len(corpus.rows)} smoke rows"
    )


@app.command()
@safe_command
def validate(repository: Path | None = None) -> None:
    """Validate local fixture provenance, scenario ownership and corpus split integrity."""
    try:
        root = repository if repository is not None else Path.cwd()
        requirements = owned_requirements(root)
        catalog = load_record(root / "fixtures/catalog.json", Catalog)
        suite = load_record(root / "scenarios/suite.json", Suite)
        validate_catalog(catalog, root / "fixtures", requirements)
        selection = load_record(root / "scenarios/selection.json", Selection)
        validate_suite(suite, catalog, requirements, selection)
        corpus = load_record(root / "benchmarks/corpus.json", Corpus)
        policy = load_record(root / "benchmarks/policy.json", Policy)
        blockers = policy_blockers(policy, corpus, ())
    except (InvalidArtifactError, ValidationError, OSError) as error:
        typer.echo(f"Validation failed: {type(error).__name__}", err=True)
        raise typer.Exit(1) from error
    typer.echo(
        f"Validated {len(catalog.fixtures)} fixtures and {len(suite.cases)} scenario definitions"
    )
    for blocker in blockers:
        typer.echo(f"Benchmark promotion BLOCKED: {blocker}")


@app.command()
@safe_command
def run(  # noqa: PLR0913 - Typer maps each explicit option to a CLI parameter.
    *,
    workspace: Path | None = None,
    manifest: Annotated[Path | None, typer.Option()] = None,
    mode: Mode = Mode.MOCK,
    output: str = "reports/runs",
    authorize_paid: Annotated[bool, typer.Option()] = False,
    evaluation_diagnostics: Annotated[int, typer.Option(min=0, max=2)] = 0,
) -> None:
    """Execute selected pinned boundaries; exit 2 for incomplete product acceptance."""
    repository = Path.cwd()
    validate(repository)
    suite = load_record(repository / "scenarios/suite.json", Suite)
    catalog = load_record(repository / "fixtures/catalog.json", Catalog)
    tracker = load_record(repository / "planning/acceptance-checklist.json", Tracker)
    settings = Settings(
        repository=repository,
        workspace=workspace or repository.parent,
        assembly_path=manifest,
        mode=mode,
        context="ci" if os.environ.get("CI") == "true" else "local",
        authorize_paid=authorize_paid,
    )
    receipt, captures = execute_captured(suite, catalog, settings)
    history = History(runs=(receipt,))
    requirements = load_record(repository / "planning/requirements.json", Requirements)
    directory = save_history(
        history, Path(output), tracker, suite, settings.artifacts, requirements=requirements
    )
    if captures:
        save_comparisons(captures, receipt, directory)
    export_audit(
        audit(
            history,
            tracker,
            requirements,
            suite,
            evidence_index=load_record(directory / "evidence-index.json", EvidenceIndex),
        ),
        directory / "release-audit.json",
    )
    for _ in range(evaluation_diagnostics):
        diagnostic = replay_comparisons(history, captures, suite)
        history = History(runs=(*history.runs, diagnostic))
        directory = save_history(
            history, Path(output), tracker, suite, settings.artifacts, requirements=requirements
        )
        export_audit(
            audit(
                history,
                tracker,
                requirements,
                suite,
                evidence_index=load_record(directory / "evidence-index.json", EvidenceIndex),
            ),
            directory / "release-audit.json",
        )
    typer.echo(str(directory))
    if not receipt.selected_case_ids or any(
        result.outcome.value != "passed"
        for result in receipt.results
        if result.case_id in receipt.selected_case_ids
    ):
        raise typer.Exit(2)


@app.command()
@safe_command
def inspect(receipt: Path, suite: Path | None = None) -> None:
    """Reject inconsistent or sensitive run receipts before public packaging."""
    record = load_record(receipt, Run)
    trusted_suite = suite if suite is not None else Path("scenarios/suite.json")
    validate_run(record, load_record(trusted_suite, Suite))
    validate_evidence(record.evidence, receipt.parent, record)
    typer.echo(f"Validated immutable receipt {record.id}")


@app.command()
@safe_command
def benchmark(
    corpus: Path, samples: Path, policy: Path | None = None, receipt_root: Path | None = None
) -> None:
    """Compute actual raw-sample metrics; report promotion blockers separately."""
    dataset = load_record(corpus, Corpus)
    raw = TypeAdapter(tuple[Sample, ...]).validate_json(read_bytes(samples))
    blockers = validate_corpus(dataset)
    for candidate in ("rules", "generative", "jev"):
        for question, stratum in sorted({(row.question, row.stratum) for row in dataset.rows}):
            metrics = summarize(raw, dataset.rows, candidate, question, stratum)
            typer.echo(metrics.model_dump_json())
    low, high = paired_family_interval(dataset.rows, raw)
    typer.echo(f"Paired family accuracy difference 95% interval: [{low}, {high}]")
    for blocker in blockers:
        typer.echo(f"Promotion BLOCKED: {blocker}")
    if policy is not None:
        typer.echo(
            promotion(load_record(policy, Policy), dataset, raw, receipt_root).model_dump_json()
        )


@app.command()
@safe_command
def contracts(
    pin: Annotated[Path, typer.Option()],
    producer: Annotated[Path, typer.Option()],
    runtime: Annotated[Path, typer.Option()],
    output: Annotated[Path, typer.Option()],
    *,
    candidate_scope: Annotated[bool, typer.Option()] = False,
) -> None:
    """Execute pinned canonical SDK fixtures; full missing scope exits blocked."""
    node = load_record(runtime, ContractRuntime)
    installed = (
        InstalledPackage(Path(node.installation.root), Path(node.installation.archive))
        if node.installation is not None
        else None
    )
    receipt = execute_contracts(
        ContractSettings(
            repository=Path.cwd(),
            producer=producer,
            node=Path(node.path),
            node_digest=node.sha256,
            pin=load_record(pin, ContractPin),
            candidate_scope=candidate_scope,
            installed=installed,
        )
    )
    directory = save_contract_receipt(receipt, output)
    typer.echo(str(directory))
    if receipt.execution != "passed":
        raise typer.Exit(1)
    if receipt.missing_contracts and not candidate_scope:
        raise typer.Exit(2)


@app.command()
@safe_command
def contract_runtime(
    node: Annotated[Path, typer.Option()], output: Annotated[Path, typer.Option()]
) -> None:
    """Stage the actual binary identity for review; this creates no runtime authority."""
    record = ContractRuntime(path=str(node.resolve()), sha256=runtime_digest(node))
    with output.open("x", encoding="utf-8") as destination:
        _ = destination.write(record.model_dump_json(indent=2))


_ = app.command()(safe_command(history_cli.replay_evaluation))
_ = app.command()(safe_command(history_cli.history_report))
_ = app.command()(safe_command(history_cli.benchmark_history))
_ = app.command()(safe_command(schema_exports.schemas))
_ = app.command()(safe_command(evidence_cli.evidence_index))
