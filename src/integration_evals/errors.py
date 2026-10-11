"""Structured validation failures safe to publish without source payloads."""

from typing import Never, override


class InvalidArtifactError(Exception):
    """An artifact violates the declared evaluation boundary.

    BaseException metadata must remain mutable for traceback, chaining and notes.
    """

    __slots__: tuple[str, str] = ("code", "reference")

    def __init__(self, code: str, reference: str) -> None:
        """Initialize the diagnostic fields and standard exception arguments."""
        super().__init__(code, reference)
        self.code: str = code
        self.reference: str = reference

    @override
    def __str__(self) -> str:
        """Return a diagnostic without embedding potentially private input."""
        return f"{self.code}: {self.reference}"


def fail(code: str, reference: str) -> Never:
    """Raise a structured failure without including private payloads."""
    raise InvalidArtifactError(code, reference)
