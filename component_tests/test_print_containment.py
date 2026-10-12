import os
from pathlib import Path

from component_tests.print_containment import STDERR_LIMIT, probe, stderr_observation


def test_harmless_command_under_unchanged_print_containment() -> None:
    # Given the same offline container, pinned source and evaluator containment prefix.
    checkout = Path(os.environ["IE_PRINT_SOURCE"]).resolve()
    destination = Path(os.environ["IE_PRINT_EVIDENCE"]) / "containment-probe.json"
    # When a bounded /bin/true process attempts only the existing containment boundary.
    receipt = probe(checkout, destination)
    # Then retain actual denial before failing; success is characterization only.
    assert receipt.platform == "linux"
    assert receipt.outcome == "completed"
    assert receipt.exit_code == 0, receipt.model_dump_json()


def test_diagnostic_output_excludes_private_unknown_lines() -> None:
    # Given one fixed denial and unknown text containing a private credential marker.
    safe = b"bwrap: Creating new namespace failed: Operation not permitted"
    data = safe + b"\nIE_SECRET_CANARY_PRIVATE_VALUE\n"
    # When sanitizing the captured diagnostic bytes.
    observed = stderr_observation(data)
    # Then only the fixed message is emitted and the unknown text is explicitly flagged.
    assert observed.safe_lines == (safe.decode(),)
    assert observed.unknown_lines is True
    assert b"IE_SECRET_CANARY_PRIVATE_VALUE" not in observed.model_dump_json().encode()


def test_diagnostic_output_marks_capture_limit() -> None:
    # Given more bytes than the fixed diagnostic bound.
    data = b"x" * (STDERR_LIMIT + 2)
    # When sanitizing the bounded prefix.
    observed = stderr_observation(data)
    # Then the receipt admits truncation and exports no unknown text.
    assert observed.truncated is True
    assert observed.safe_lines == ()


def test_diagnostic_output_keeps_unknown_denial_unknown() -> None:
    # Given an unrecognized failure with a path rather than an allowlisted fixed message.
    data = b"bwrap: unknown error at /private/example\n"
    # When sanitizing the failure.
    observed = stderr_observation(data)
    # Then no inferred permission diagnosis or path is exported.
    assert observed.unknown_lines is True
    assert observed.safe_lines == ()


def test_diagnostic_output_bounds_namespace_denial_detail() -> None:
    # Given a known namespace-denial prefix followed by untrusted detail.
    prefix = b"bwrap: No permissions to creating new namespace,"
    # When reducing the diagnostic message to its fixed observed prefix.
    observed = stderr_observation(prefix + b" /private/unknown IE_SECRET_CANARY_HIDDEN")
    # Then no policy workaround, path or arbitrary detail appears in the receipt.
    assert observed.safe_lines == (prefix.decode(),)
    assert observed.unknown_lines is True
    assert b"IE_SECRET_CANARY_HIDDEN" not in observed.model_dump_json().encode()
