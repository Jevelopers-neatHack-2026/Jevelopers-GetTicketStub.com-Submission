"""Clock injection preserves ordinary defaults and grants no execution authority."""

from dataclasses import FrozenInstanceError
from datetime import UTC, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

import pytest
from pydantic import JsonValue, TypeAdapter

from component_tests.print_clock import GUARDED_CLOCK
from component_tests.print_protocol import Invocation
from integration_evals.artifacts import load_record
from integration_evals.errors import InvalidArtifactError
from integration_evals.execution import Settings
from integration_evals.models import Catalog, Mode, Suite
from integration_evals.print_setup import (
    CONFIGURATION_PATH,
    PROFILE_PATH,
    PrintConfiguration,
    PrintProfile,
)
from integration_evals.processes import ProcessSettings
from integration_evals.runner import execute

REPOSITORY = Path(__file__).resolve().parents[1]


class NoDispatch:
    def __call__(self, command: tuple[str, ...], settings: ProcessSettings) -> int:
        _ = (command, settings)
        message = "Clock-only unit test must not dispatch an owner"
        raise AssertionError(message)


@pytest.mark.parametrize("override", [None, GUARDED_CLOCK])
def test_clock_default_and_explicit_mock_keep_wall_time_separate(
    tmp_path: Path, override: datetime | None
) -> None:
    suite = load_record(REPOSITORY / "scenarios/suite.json", Suite)
    catalog = load_record(REPOSITORY / "fixtures/catalog.json", Catalog)
    settings = Settings(
        REPOSITORY,
        tmp_path,
        None,
        test_invocation=NoDispatch() if override else None,
        test_clock=override,
    )
    before = datetime.now(UTC)
    run = execute(suite, catalog, settings)
    after = datetime.now(UTC)
    assert run.clock == (override or datetime(2026, 10, 10, tzinfo=UTC))
    assert before <= run.started_at <= after
    assert len(run.results) == 42
    assert run.evidence == ()
    assert all(result.exit_code is None for result in run.results)
    assert settings.test_clock == override
    with pytest.raises(FrozenInstanceError):
        settings.__setattr__("test_clock", datetime(2026, 10, 10, tzinfo=UTC))


@pytest.mark.parametrize("mode", [Mode.RECORDED, Mode.SANDBOX, Mode.LIVE])
def test_clock_refuses_any_nonmock_mode(tmp_path: Path, mode: Mode) -> None:
    with pytest.raises(InvalidArtifactError, match="test_clock_requires_guarded_mock"):
        _ = Settings(
            tmp_path,
            tmp_path,
            None,
            mode=mode,
            test_invocation=NoDispatch(),
            test_clock=GUARDED_CLOCK,
        )
    assert not (tmp_path / ".integration-evals-artifacts").exists()


@pytest.mark.parametrize(("guarded", "paid"), [(False, False), (True, True)])
def test_clock_refuses_unguarded_or_paid_context(tmp_path: Path, guarded: bool, paid: bool) -> None:
    with pytest.raises(InvalidArtifactError, match="test_clock_requires_guarded_mock"):
        _ = Settings(
            tmp_path,
            tmp_path,
            None,
            test_invocation=NoDispatch() if guarded else None,
            authorize_paid=paid,
            test_clock=GUARDED_CLOCK,
        )


@pytest.mark.parametrize(
    "clock",
    [
        GUARDED_CLOCK.replace(tzinfo=None),
        datetime(2026, 10, 10, 12, 30, tzinfo=timezone(timedelta(hours=1))),
        datetime(2026, 10, 10, 12, 30, tzinfo=timezone(timedelta(0), "not-UTC")),
    ],
)
def test_clock_refuses_naive_and_nonutc_values(tmp_path: Path, clock: datetime) -> None:
    with pytest.raises(InvalidArtifactError, match="test_clock_requires_aware_utc"):
        _ = Settings(tmp_path, tmp_path, None, test_invocation=NoDispatch(), test_clock=clock)


def test_original_protocol_environment_payload_share_explicit_logical_clock(tmp_path: Path) -> None:
    evaluator = tmp_path / "integration-evals"
    (evaluator / "scenarios").mkdir(parents=True)
    _ = (evaluator / "scenarios/suite.json").write_bytes(
        (REPOSITORY / "scenarios/suite.json").read_bytes()
    )
    configuration = evaluator / CONFIGURATION_PATH
    configuration.parent.mkdir(parents=True, exist_ok=True)
    _ = configuration.write_text(
        PrintConfiguration(
            node_sha256="0" * 64,
            browser_root="/ms-playwright",
            renderer_image=load_record(REPOSITORY / PROFILE_PATH, PrintProfile).image,
        ).model_dump_json()
    )
    home = tmp_path / "home"
    home.mkdir()
    original = Invocation(tmp_path, home, "replay")
    guarded = Invocation(tmp_path, home, "replay", NoDispatch(), clock=GUARDED_CLOCK)
    for invocation, expected in (
        (original, datetime(2026, 10, 10, tzinfo=UTC)),
        (guarded, GUARDED_CLOCK),
    ):
        settings = invocation.settings(BytesIO())
        payload = TypeAdapter(dict[str, JsonValue]).validate_json(settings.payload)
        assert settings.environment["IE_CLOCK"] == payload["clock"] == expected.isoformat()
