from collections.abc import Generator
from contextlib import contextmanager

import pytest

from integration_evals.artifacts import reject_leaks
from integration_evals.errors import InvalidArtifactError, fail


@contextmanager
def boundary() -> Generator[None]:
    yield


def test_generator_context_preserves_original_validation_error() -> None:
    # Given the same structured error a validator would raise.
    error = InvalidArtifactError("INVALID_RECORD", "record.json")
    # When a generator context manager propagates it.
    with pytest.raises(InvalidArtifactError) as caught, boundary():
        raise error
    # Then the original exception survives the boundary.
    assert caught.value is error
    assert str(caught.value) == "INVALID_RECORD: record.json"


def test_direct_failure_preserves_typed_diagnostic() -> None:
    # Given a public diagnostic code and reference.
    # When the shared failure helper raises directly.
    with pytest.raises(InvalidArtifactError) as caught:
        fail("unsafe_path", "artifact")
    # Then callers receive the typed diagnostic fields and established format.
    assert caught.value.code == "unsafe_path"
    assert caught.value.reference == "artifact"
    assert str(caught.value) == "unsafe_path: artifact"
    assert caught.value.args == ("unsafe_path", "artifact")


def test_boundary_rejection_keeps_private_payload_out_of_diagnostic() -> None:
    # Given synthetic private content that the real validator rejects.
    payload = b"IE_SECRET_CANARY_private_fixture"
    # When validation fails inside a generator boundary.
    with pytest.raises(InvalidArtifactError) as caught, boundary():
        reject_leaks(payload, "record.json")
    # Then the diagnostic contains only the stable code and safe reference.
    assert str(caught.value) == "sensitive_content: record.json"
    assert caught.value.code == "sensitive_content"
    assert caught.value.reference == "record.json"


def test_validation_error_accepts_exception_notes() -> None:
    # Given an error with standard exception metadata.
    error = InvalidArtifactError("INVALID_RECORD", "record.json")
    # When handlers annotate it through the BaseException API.
    error.add_note("validation boundary")
    error.add_note("safe reference only")
    # Then notes accumulate without replacing the diagnostic.
    assert error.__notes__ == ["validation boundary", "safe reference only"]
    assert str(error) == "INVALID_RECORD: record.json"


def test_validation_error_supports_traceback_restoration() -> None:
    # Given a traceback from an ordinary raise.
    error = InvalidArtifactError("INVALID_RECORD", "record.json")
    with pytest.raises(InvalidArtifactError):
        raise error
    traceback = error.__traceback__
    assert traceback is not None
    # When a handler clears and restores runtime traceback metadata.
    error.__traceback__ = None
    restored = error.with_traceback(traceback)
    # Then the original exception and traceback remain usable.
    assert restored is error
    assert restored.__traceback__ is traceback


def test_generator_context_preserves_exception_chaining() -> None:
    # Given an underlying structured validation failure.
    cause = InvalidArtifactError("INVALID_SOURCE", "source.json")
    error = InvalidArtifactError("INVALID_RECORD", "record.json")
    # When a handler explicitly chains an error across the generator boundary.
    try:
        raise cause
    except InvalidArtifactError:
        with pytest.raises(InvalidArtifactError) as caught, boundary():
            raise error from cause
    # Then native cause, context and suppression semantics survive propagation.
    assert caught.value is error
    assert error.__cause__ is cause
    assert error.__context__ is cause
    assert error.__suppress_context__
