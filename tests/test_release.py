from pathlib import Path

from integration_evals.artifacts import load_record
from integration_evals.execution import Settings
from integration_evals.models import Catalog, Suite
from integration_evals.release import audit
from integration_evals.reporting import Tracker
from integration_evals.runner import execute
from integration_evals.specifications import Requirements

REPOSITORY = Path(__file__).resolve().parents[1]


def test_audit_retains_every_leaf_when_components_missing() -> None:
    # Given the live launch acceptance inventory and an unavailable composed release.
    requirements = load_record(REPOSITORY / "planning/requirements.json", Requirements)
    tracker = load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    run = execute(suite, catalog, Settings(REPOSITORY, REPOSITORY.parent, None))
    # When auditing release scope.
    receipt = audit(run, tracker, requirements, suite)
    # Then no local leaf or original non-v1 exclusion disappears from the report.
    assert {leaf.id for leaf in requirements.leaves}.issubset(
        {item.id for item in receipt.obligations}
    )
    assert set(receipt.exclusions) == {"BUD-04", "LIVE-01", "LIVE-02", "LIVE-03"}
    assert tracker == load_record(REPOSITORY / "planning/acceptance-checklist.json", Tracker)
