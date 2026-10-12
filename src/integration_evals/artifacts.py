"""Content-addressed input access and credential-safe evidence inspection."""

import errno
import hashlib
import json
import os
import re
import stat
from pathlib import Path
from time import monotonic
from typing import Final
from urllib.parse import parse_qsl, urlsplit

from pydantic import BaseModel, JsonValue

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


def _read_deadline(deadline: float | None) -> None:
    """Reject an expired caller-owned read budget without exposing the input path."""
    if deadline is not None and monotonic() >= deadline:
        raise TimeoutError(errno.ETIMEDOUT, "Artifact read deadline expired")


def read_bytes(path: Path, *, max_bytes: int | None = None, deadline: float | None = None) -> bytes:
    """Open without blocking or following links, then bound the bytes actually read."""
    limit = MAX_ARTIFACT_BYTES if max_bytes is None else max_bytes
    if limit <= 0:
        fail("invalid_artifact_byte_limit", path.name)
    _read_deadline(deadline)
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
        remaining = limit + 1
        while remaining > 0:
            _read_deadline(deadline)
            chunk = os.read(descriptor, min(remaining, 1024 * 1024))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
    finally:
        os.close(descriptor)
    if remaining <= 0:
        fail("oversized_artifact", path.name)
    _read_deadline(deadline)
    return b"".join(chunks)


def load_record[Model: BaseModel](path: Path, model: type[Model]) -> Model:
    """Parse an external record through its strict versioned schema."""
    return model.model_validate_json(read_bytes(path))


class _AmbiguousJsonError(Exception):
    """Decoded JSON repeats an object key, so a later value could hide an earlier one."""


def _unique_pairs(pairs: list[tuple[str, JsonValue]]) -> dict[str, JsonValue]:
    """Fail closed on duplicate decoded keys, including differently escaped spellings."""
    decoded = dict(pairs)
    if len(decoded) != len(pairs):
        raise _AmbiguousJsonError
    return decoded


def _decode(raw: bytes | str) -> JsonValue:
    result: JsonValue = json.loads(raw, object_pairs_hook=_unique_pairs)  # pyright: ignore[reportAny]
    return result


def _pattern_hit(data: bytes) -> bool:
    return any(pattern.search(data) for pattern in SECRET_PATTERNS)


def _url_code(data: bytes) -> str | None:
    """Return the URL policy failure code for embedded URLs, if any."""
    for match in re.finditer(rb"https?://[^\s\"<>]+", data):
        try:
            parsed = urlsplit(match.group().decode())
        except (UnicodeDecodeError, ValueError):
            return "invalid_export_reference"
        if parsed.username or parsed.password:
            return "credential_url"
        if any(key.lower() in SIGNED_KEYS for key, _ in parse_qsl(parsed.query)):
            return "signed_access_url"
    return None


def _plaintext_code(data: bytes) -> str | None:
    """Apply the complete plaintext policy: secret patterns, then URL rules."""
    return "sensitive_content" if _pattern_hit(data) else _url_code(data)


def _text_code(value: str, depth: int) -> str | None:
    """Apply the plaintext policy to decoded text, descending into embedded JSON."""
    code = _plaintext_code(value.encode(errors="replace"))
    if code or value.lstrip()[:1] not in {"{", "[", '"'}:
        return code
    try:
        nested = _decode(value)
    except json.JSONDecodeError:
        return None  # Text, not JSON. Other ValueErrors (resource limits) propagate.
    return _json_code(nested, depth + 1)


def _entry_code(key: str, item: JsonValue, depth: int) -> str | None:
    if (
        key.lower().replace("-", "_") in SENSITIVE_JSON_KEYS
        and isinstance(item, str)
        and len(item) >= MIN_SECRET
    ):
        return "sensitive_content"
    return _text_code(key, depth) or _json_code(item, depth + 1)


def _json_code(value: JsonValue, depth: int = 0) -> str | None:
    """Scan every decoded key and string value; excess depth fails closed."""
    if depth > MAX_JSON_DEPTH:
        return "sensitive_content"
    if isinstance(value, dict):
        return next((c for k, v in value.items() if (c := _entry_code(k, v, depth))), None)
    if isinstance(value, list):
        return next((c for v in value if (c := _json_code(v, depth + 1))), None)
    return _text_code(value, depth) if isinstance(value, str) else None


def _document_code(data: bytes) -> str | None:
    """Scan JSON documents; ambiguous or pathological structure is treated as a leak."""
    try:
        return _json_code(_decode(data))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None  # Not a JSON document; the raw policy applies separately.
    except (ValueError, _AmbiguousJsonError, RecursionError):
        return "sensitive_content"  # Resource limits and ambiguity fail closed.


def reject_leaks(data: bytes, reference: str) -> None:
    """Reject sensitive exports without including the matched value in errors."""
    code = ("sensitive_content" if _pattern_hit(data) else None) or _document_code(data)
    code = code or _url_code(data)
    if code:
        fail(code, reference)


def public_reference(reference: str) -> None:
    """Reject credentials and temporary credentials embedded in evidence URLs."""
    reject_leaks(reference.encode(), "reference")
    parsed = urlsplit(reference)
    if parsed.username or parsed.password:
        fail("credential_url", "reference")
