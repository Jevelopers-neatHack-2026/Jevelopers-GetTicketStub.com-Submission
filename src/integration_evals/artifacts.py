"""Content-addressed input access and credential-safe evidence inspection."""

import errno
import hashlib
import os
import re
import stat
from pathlib import Path
from typing import Final
from urllib.parse import parse_qsl, urlsplit

from pydantic import BaseModel, JsonValue, TypeAdapter

from integration_evals.errors import fail

MAX_ARTIFACT_BYTES: Final = 8 * 1024 * 1024
CREDENTIAL_KEYS: Final = rb"(?i)(?:authorization|api[_-]?key|password|client_secret)"
QUOTED_SEPARATOR: Final = rb"(?:\\*[\"'])?\s*[:=]\s*(?:\\*[\"'])?"
SECRET_PATTERNS: Final = (
    re.compile(rb"(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{16,}"),
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    # Plain, quoted and backslash-escaped (nested JSON) key/value forms.
    re.compile(CREDENTIAL_KEYS + QUOTED_SEPARATOR + rb"[^\s\"'\\]{8,}"),
    re.compile(rb"(?i)\bbearer\s+(?:\\*[\"'])?[A-Za-z0-9._~+/=-]{8,}"),
    re.compile(rb"IE_SECRET_CANARY_[A-Za-z0-9_]+"),
    re.compile(rb"IE_PII_CANARY_[A-Za-z0-9_]+"),
)
SENSITIVE_JSON_KEYS: Final = frozenset(
    {"authorization", "api_key", "apikey", "password", "client_secret"}
)
MAX_JSON_DEPTH: Final = 32
MIN_SECRET: Final = 8
JSON: Final = TypeAdapter(JsonValue)
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
    """Open without blocking or following links, then bound the bytes actually read."""
    flags = os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        if error.errno == errno.ELOOP:
            fail("symlink_artifact", path.name)
        raise
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            fail("non_regular_artifact", path.name)
        chunks: list[bytes] = []
        remaining = MAX_ARTIFACT_BYTES + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(remaining, 1024 * 1024))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
    finally:
        os.close(descriptor)
    if remaining <= 0:
        fail("oversized_artifact", path.name)
    return b"".join(chunks)


def load_record[Model: BaseModel](path: Path, model: type[Model]) -> Model:
    """Parse an external record through its strict versioned schema."""
    return model.model_validate_json(read_bytes(path))


def _text_leak(value: str, depth: int) -> bool:
    """Scan decoded text, descending into JSON documents embedded in strings."""
    if any(pattern.search(value.encode(errors="replace")) for pattern in SECRET_PATTERNS):
        return True
    if value.lstrip()[:1] not in {"{", "["}:
        return False
    try:
        nested = JSON.validate_json(value)
    except ValueError:
        return False
    return _json_leak(nested, depth + 1)


def _json_leak(value: JsonValue, depth: int = 0) -> bool:
    """Find sensitive keys and secret text in decoded (including string-embedded) JSON."""
    if depth > MAX_JSON_DEPTH:
        return True
    if isinstance(value, dict):
        return any(
            (
                key.lower().replace("-", "_") in SENSITIVE_JSON_KEYS
                and isinstance(item, str)
                and len(item) >= MIN_SECRET
            )
            or _json_leak(item, depth + 1)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(_json_leak(item, depth + 1) for item in value)
    return isinstance(value, str) and _text_leak(value, depth)


def reject_leaks(data: bytes, reference: str) -> None:
    """Reject sensitive exports without including the matched value in errors."""
    if any(pattern.search(data) for pattern in SECRET_PATTERNS):
        fail("sensitive_content", reference)
    try:
        decoded = JSON.validate_json(data)
    except ValueError:
        decoded = None
    if decoded is not None and _json_leak(decoded):
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
