from pathlib import Path

import pytest
from typer.testing import CliRunner

from integration_evals.artifacts import digest
from integration_evals.cli import app
from integration_evals.models import Mode, Origin, Outcome, Status, Suite
from tests.test_evidence_claims import artifact, context_for, controlled_case
from tests.test_reporting import absent_assembly


@pytest.mark.parametrize(
    "mutation",
    ["producer", "kind", "origin", "missing", "suite-pin", "scope", "requirements"],
)
def test_archived_claim_requires_frozen_case_rules(tmp_path: Path, mutation: str) -> None:
    # Given an otherwise valid archive and independently supplied case contract.
    case = controlled_case()
    suite = Suite(cases=(case,))
    context = context_for(tmp_path, Mode.LIVE)
    item = artifact(case, context).model_copy(update={"origin": Origin.LIVE})
    _ = (tmp_path / item.path).write_bytes(b'{"result":"controlled"}')
    baseline = absent_assembly()
    result = baseline.results[0].model_copy(
        update={
            "case_id": case.id,
            "requirements": case.requirements,
            "outcome": Outcome.PASSED,
            "criterion_status": Status.IN_PROGRESS,
            "mode": Mode.LIVE,
            "origin": Origin.LIVE,
            "evidence_ids": (item.id,),
            "reason": None,
            "cleanup_status": "passed",
            "exit_code": 0,
            "output_digest": digest(b"fixture response"),
        }
    )
    other = context.assembly.components[0].model_copy(update={"repository": "cost-intelligence"})
    run = baseline.model_copy(
        update={
            "id": context.run_id,
            "components": (*context.assembly.components, other),
            "results": (result,),
            "evidence": (item,),
            "selected_case_ids": (case.id,),
            "suite_digest": digest(suite.model_dump_json().encode()),
        }
    )
    receipt = tmp_path / "run.json"
    contract = tmp_path / "trusted-suite.json"
    _ = contract.write_text(suite.model_dump_json(), encoding="utf-8")
    _ = receipt.write_text(run.model_dump_json(), encoding="utf-8")
    command = ["inspect", str(receipt), "--suite", str(contract)]
    positive = CliRunner().invoke(app, command)
    assert positive.exit_code == 0, positive.output
    # When one claim diverges from the exact independently pinned contract.
    if mutation == "producer":
        run = run.model_copy(
            update={"evidence": (item.model_copy(update={"component": other.repository}),)}
        )
    elif mutation == "kind":
        run = run.model_copy(update={"evidence": (item.model_copy(update={"kind": "forecast"}),)})
    elif mutation == "origin":
        run = run.model_copy(
            update={"evidence": (item.model_copy(update={"origin": Origin.SYNTHETIC}),)}
        )
    elif mutation == "missing":
        run = run.model_copy(
            update={"evidence": (), "results": (result.model_copy(update={"evidence_ids": ()}),)}
        )
    elif mutation == "suite-pin":
        run = run.model_copy(update={"suite_digest": digest(b"different contract")})
    elif mutation == "scope":
        larger = Suite(cases=(case, case.model_copy(update={"id": "extra"})))
        _ = contract.write_text(larger.model_dump_json(), encoding="utf-8")
        run = run.model_copy(update={"suite_digest": digest(larger.model_dump_json().encode())})
    else:
        run = run.model_copy(
            update={
                "results": (
                    result.model_copy(update={"requirements": (*case.requirements, "unrelated")}),
                )
            }
        )
    _ = receipt.write_text(run.model_dump_json(), encoding="utf-8")
    rejected = CliRunner().invoke(app, command)
    # Then the public archive surface rejects the altered receipt.
    assert rejected.exit_code == 1, rejected.output
