"""Content-addressed input access and credential-safe evidence inspection."""

import hashlib
import re
from pathlib import Path
from typing import Final
from urllib.parse import parse_qsl, urlsplit

from pydantic import BaseModel

from integration_evals.errors import fail

MAX_ARTIFACT_BYTES: Final = 8 * 1024 * 1024
SECRET_PATTERNS: Final = (
    re.compile(rb"(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{16,}"),
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(
        rb"(?i)(?:authorization|api[_-]?key|password|client_secret)\s*[:=]\s*[\"']?[^\s\"']{8,}"
    ),
    re.compile(rb"IE_SECRET_CANARY_[A-Za-z0-9_]+"),
    re.compile(rb"IE_PII_CANARY_[A-Za-z0-9_]+"),
)
SIGNED_KEYS: Final = frozenset(
    {"token", "signature", "sig", "access_token", "x-amz-signature", "x-goog-signature"}
)


def digest(data: bytes) -> str:
    """Address exact bytes, without JSON reformatting or newline normalization."""
    return hashlib.sha256(data).hexdigest()


def confined_path(root: Path, relative: str) -> Path:
    """Reject traversal and symlinks escaping the approved artifact root."""
    candidate = (root / relative).resolve()
    if Path(relative).is_absolute() or not candidate.is_relative_to(root.resolve()):
        fail("unsafe_path", "artifact")
    return candidate


def read_bytes(path: Path) -> bytes:
    """Bound input size before parsing, including a growing file."""
    with path.open("rb") as handle:
        data = handle.read(MAX_ARTIFACT_BYTES + 1)
    if len(data) > MAX_ARTIFACT_BYTES:
        fail("oversized_artifact", path.name)
    return data


def load_record[Model: BaseModel](path: Path, model: type[Model]) -> Model:
    """Parse an external record through its strict versioned schema."""
    return model.model_validate_json(read_bytes(path))


def reject_leaks(data: bytes, reference: str) -> None:
    """Reject sensitive exports without including the matched value in errors."""
    if any(pattern.search(data) for pattern in SECRET_PATTERNS):
        fail("sensitive_content", reference)
    for match in re.finditer(rb"https?://[^\s\"<>]+", data):
        raw = match.group()
        try:
            parsed = urlsplit(raw.decode())
        except (UnicodeDecodeError, ValueError):
            fail("invalid_export_reference", reference)
        if parsed.username or parsed.password:
            fail("credential_url", reference)
        if any(key.lower() in SIGNED_KEYS for key, _ in parse_qsl(parsed.query)):
            fail("signed_access_url", reference)


def public_reference(reference: str) -> None:
    """Reject credentials and temporary credentials embedded in evidence URLs."""
    reject_leaks(reference.encode(), "reference")
    parsed = urlsplit(reference)
    if parsed.username or parsed.password:
        fail("credential_url", "reference")
