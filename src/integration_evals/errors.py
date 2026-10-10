"""Structured validation failures safe to publish without source payloads."""

from dataclasses import dataclass
from typing import Never, override


@dataclass(frozen=True, slots=True)
class InvalidArtifactError(Exception):
    """An artifact violates the declared evaluation boundary."""

    code: str
    reference: str

    @override
    def __str__(self) -> str:
        """Return a diagnostic without embedding potentially private input."""
        return f"{self.code}: {self.reference}"


def fail(code: str, reference: str) -> Never:
    """Raise a structured failure without including private payloads."""
    raise InvalidArtifactError(code, reference)
