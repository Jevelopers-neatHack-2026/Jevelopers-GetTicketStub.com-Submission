"""Generate exact evaluation-owned schemas without modifying product contract authority."""

import json
from pathlib import Path

from integration_evals.benchmark_history import BenchmarkArchive, BenchmarkHistory
from integration_evals.benchmark_receipts import BenchmarkReceipt
from integration_evals.benchmarks import Corpus, Sample
from integration_evals.comparison_archive import ComparisonBundle
from integration_evals.contract_records import ContractPin, ContractReceipt, ContractRuntime
from integration_evals.evidence_index import EvidenceIndex, Reviews
from integration_evals.history import CaseHistory, History, Quarantine
from integration_evals.history_archive import Successor
from integration_evals.models import Assembly, Catalog, Evidence, Run, Selection, Suite
from integration_evals.numeric_rules import NumericRules
from integration_evals.policy import Policy, Promotion
from integration_evals.reporting import OwnerResponse, Tracker
from integration_evals.specifications import Requirements


def schemas(destination: Path) -> None:
    """Export evaluator schemas; canonical product schemas are supplied by shared-contracts."""
    destination.mkdir(parents=True, exist_ok=True)
    models = (
        Assembly,
        Catalog,
        Suite,
        Run,
        Tracker,
        Requirements,
        Corpus,
        Sample,
        Evidence,
        OwnerResponse,
        Policy,
        Promotion,
        Selection,
        BenchmarkReceipt,
        NumericRules,
        ContractPin,
        ContractReceipt,
        ContractRuntime,
        History,
        Quarantine,
        BenchmarkHistory,
        BenchmarkArchive,
        CaseHistory,
        Successor,
        ComparisonBundle,
        EvidenceIndex,
        Reviews,
    )
    for model in models:
        with (destination / f"{model.__name__}.schema.json").open("w", encoding="utf-8") as output:
            _ = output.write(json.dumps(model.model_json_schema(), indent=2))
