"""Internal privacy boundary primitives for untrusted event evidence.

These types are deliberately local scaffolding. They are not the agreed EI API,
ResearchRequest, identity authority, durable store, or an extraction engine.
"""

from __future__ import annotations

import re
import secrets
import threading
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from html.parser import HTMLParser
from typing import Callable, Dict, Optional, Tuple, Union


class ContentModality(Enum):
    HTML = "html"
    OCR_TEXT = "ocr_text"
    PDF_TEXT = "pdf_text"
    PDF_METADATA = "pdf_metadata"
    PLAIN_TEXT = "plain_text"
    IMAGE_BINARY = "image_binary"
    PDF_BINARY = "pdf_binary"
    ATTENDEE_CSV = "attendee_csv"
    UNKNOWN_BINARY = "unknown_binary"


class TrustTag(Enum):
    UNTRUSTED_EXTERNAL = "untrusted_external"


class SessionState(Enum):
    ACCEPTING = "accepting"
    REDACTED = "redacted_pending_publish"
    PUBLISHED = "published_sanitized_derivative"
    QUARANTINED = "quarantined_private_review"
    CANCELLED = "cancelled"


class QuarantineCode(Enum):
    UNSUPPORTED_MODALITY = "unsupported_modality"
    OPAQUE_BINARY = "opaque_binary_requires_review"
    ATTENDEE_DATA = "attendee_data_requires_private_review"
    INVALID_UTF8 = "invalid_utf8"
    EMPTY_CONTENT = "empty_content"
    INVALID_FIELDS = "invalid_or_unapproved_fields"
    NO_ADMITTED_FIELDS = "no_admitted_public_fields"
    CANCELLED = "cancelled_before_publication"


class PrivateAccessPurpose(Enum):
    PRIVATE_REVIEW = "private_review"
    PROCESSING_RETRY = "processing_retry"


class PrivateEvidenceUnavailable(Exception):
    """Constant-message denial; never includes a tenant, ref, or payload."""

    def __init__(self) -> None:
        super().__init__("private evidence unavailable")


@dataclass(frozen=True)
class TrustedTenantContext:
    """Scope injected by the authenticated application boundary.

    Constructing this value does not authenticate anyone. Callers must supply it
    from a verified app-owned identity contract; browser and source IDs are not
    accepted as tenant authority here.
    """

    tenant_id: str = field(repr=False)

    def __post_init__(self) -> None:
        if type(self.tenant_id) is not str or not self.tenant_id.strip():
            raise ValueError("trusted tenant context required")


@dataclass(frozen=True)
class SourceDocument:
    """Raw external input. `external_reference` is provenance only, never auth."""

    modality: Union[ContentModality, str]
    payload: Union[str, bytes] = field(repr=False)
    external_reference: str = field(default="", repr=False)


@dataclass(frozen=True)
class RetentionPolicy:
    ttl_seconds: int
    allow_private_review: bool

    def __post_init__(self) -> None:
        if type(self.ttl_seconds) is not int or self.ttl_seconds <= 0:
            raise ValueError("positive original-retention TTL required")
        if type(self.allow_private_review) is not bool:
            raise ValueError("explicit private-review policy required")


@dataclass(frozen=True)
class PrivateOriginalRef:
    _token: str = field(repr=False)


@dataclass(frozen=True)
class _VaultEntry:
    tenant_id: str = field(repr=False)
    modality: Union[ContentModality, str] = field(repr=False)
    payload: Union[str, bytes] = field(repr=False)
    external_reference: str = field(repr=False)
    source_ref: str = field(repr=False)
    expires_at: datetime


class PrivateOriginalVault:
    """Process-local reference store with tenant checks and explicit expiration.

    This in-memory implementation demonstrates the boundary. It does not claim
    durable storage, encryption at rest, distributed retention, or app auth.
    """

    def __init__(
        self,
        retention: RetentionPolicy,
        clock: Optional[Callable[[], datetime]] = None,
    ) -> None:
        if not isinstance(retention, RetentionPolicy):
            raise ValueError("explicit retention policy required")
        self._retention = retention
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._entries: Dict[str, _VaultEntry] = {}
        self._lock = threading.RLock()

    def _store(self, context: TrustedTenantContext, document: SourceDocument, source_ref: str) -> PrivateOriginalRef:
        _require_context(context)
        if type(document.payload) not in (str, bytes):
            raise ValueError("unsupported private payload type")
        token = secrets.token_urlsafe(32)
        entry = _VaultEntry(
            tenant_id=context.tenant_id,
            modality=document.modality,
            payload=document.payload,
            external_reference=document.external_reference,
            source_ref=source_ref,
            expires_at=self._clock() + timedelta(seconds=self._retention.ttl_seconds),
        )
        with self._lock:
            self._entries[token] = entry
        return PrivateOriginalRef(token)

    def read(self, context: TrustedTenantContext, reference: PrivateOriginalRef) -> Union[str, bytes]:
        return self._read(context, reference, PrivateAccessPurpose.PRIVATE_REVIEW)

    def _read(
        self,
        context: TrustedTenantContext,
        reference: PrivateOriginalRef,
        purpose: PrivateAccessPurpose,
    ) -> Union[str, bytes]:
        _require_context(context)
        if not isinstance(reference, PrivateOriginalRef):
            raise PrivateEvidenceUnavailable()
        if purpose is PrivateAccessPurpose.PRIVATE_REVIEW and not self._retention.allow_private_review:
            raise PrivateEvidenceUnavailable()
        if purpose not in (PrivateAccessPurpose.PRIVATE_REVIEW, PrivateAccessPurpose.PROCESSING_RETRY):
            raise PrivateEvidenceUnavailable()
        with self._lock:
            entry = self._entries.get(reference._token)
            if entry is None:
                raise PrivateEvidenceUnavailable()
            if entry.expires_at <= self._clock():
                self._entries.pop(reference._token, None)
                raise PrivateEvidenceUnavailable()
            if entry.tenant_id != context.tenant_id:
                raise PrivateEvidenceUnavailable()
            return entry.payload

    def _entry_for_retry(self, context: TrustedTenantContext, reference: PrivateOriginalRef) -> _VaultEntry:
        _require_context(context)
        if not isinstance(reference, PrivateOriginalRef):
            raise PrivateEvidenceUnavailable()
        with self._lock:
            entry = self._entries.get(reference._token)
            if entry is None:
                raise PrivateEvidenceUnavailable()
            if entry.expires_at <= self._clock():
                self._entries.pop(reference._token, None)
                raise PrivateEvidenceUnavailable()
            if entry.tenant_id != context.tenant_id:
                raise PrivateEvidenceUnavailable()
            return entry

    def purge_expired(self) -> int:
        now = self._clock()
        with self._lock:
            expired = [token for token, entry in self._entries.items() if entry.expires_at <= now]
            for token in expired:
                del self._entries[token]
        return len(expired)


@dataclass(frozen=True)
class EvidenceProvenance:
    source_ref: str
    modality: str
    trust: TrustTag = TrustTag.UNTRUSTED_EXTERNAL


@dataclass(frozen=True)
class AdmittedFacts:
    event_name: Optional[str] = None
    event_date: Optional[str] = None
    venue: Optional[str] = None

    def as_dict(self) -> Dict[str, str]:
        values: Dict[str, Optional[str]] = {
            "event_name": self.event_name,
            "event_date": self.event_date,
            "venue": self.venue,
        }
        return {key: value for key, value in values.items() if value is not None}


@dataclass(frozen=True)
class SanitizedDerivative:
    record_id: str
    provenance: EvidenceProvenance
    facts: AdmittedFacts
    redaction_categories: Tuple[str, ...]
    _tenant_id: str = field(repr=False)
    _seal: object = field(repr=False, compare=False)


_DERIVATIVE_SEAL = object()
_RESULT_SEAL = object()


@dataclass(frozen=True)
class BoundaryResult:
    record_id: str
    state: SessionState
    modality: str
    provenance: EvidenceProvenance
    original_ref: PrivateOriginalRef = field(repr=False)
    derivative: Optional[SanitizedDerivative] = None
    quarantine_code: Optional[QuarantineCode] = None
    _tenant_id: str = field(repr=False, default="")
    _seal: object = field(repr=False, compare=False, default=None)


_ALLOWED_FIELDS = {"event_name", "event_date", "venue"}
_MAX_FIELD_LENGTHS = {"event_name": 180, "event_date": 10, "venue": 180}
_EMAIL_RE = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
_PHONE_RE = re.compile(r"(?<!\w)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}(?!\w)")
_ATTENDEE_LABEL_RE = re.compile(
    r"(?i)\b(?:attendee|ticket\s*holder|guest|contact(?:\s+person)?)"
    r"(?:\s+name)?\s*[:=]\s*[^\r\n,;|]+"
)
_SEAT_RE = re.compile(r"(?i)\bseat(?:\s*(?:number|no\.?|#))?\s*[:=#-]\s*[A-Z0-9][A-Z0-9-]{0,15}")
_ADMISSION_RE = re.compile(
    r"(?i)\b(?:admission|ticket|entry|qr)(?:\s*(?:code|number|no\.?|#))?"
    r"\s*[:=#-]\s*[A-Z0-9][A-Z0-9._-]{3,}"
)
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Z0-9._~+/-]+=*")
_URL_RE = re.compile(r"(?i)\b(?:(?:https?|ftp|file|javascript)://|www\.)[^\s<>\"']+")
_URL_SECRET_RE = re.compile(r"(?i)[?&](?:access[_-]?token|token|signature|sig|auth|key|session)=([^&#\s]+)")


class FieldAdmissionError(Exception):
    def __init__(self) -> None:
        super().__init__("invalid or unapproved fields")


def _require_context(context: TrustedTenantContext) -> None:
    if not isinstance(context, TrustedTenantContext):
        raise ValueError("trusted tenant context required")


def _safe_field_text(value: str) -> Tuple[str, Tuple[str, ...]]:
    text = unicodedata.normalize("NFKC", value)
    text = "".join(
        " " if unicodedata.category(character) in ("Cc", "Cf", "Cs") or character in "\u202a\u202b\u202d\u202e\u2066\u2067\u2068\u2069" else character
        for character in text
    ).strip()
    categories = set()

    if _ATTENDEE_LABEL_RE.search(text):
        text = _ATTENDEE_LABEL_RE.sub("[REDACTED_PERSONAL_DETAIL]", text)
        categories.add("person_label")
    if _EMAIL_RE.search(text):
        text = _EMAIL_RE.sub("[REDACTED_EMAIL]", text)
        categories.add("email")
    if _PHONE_RE.search(text):
        text = _PHONE_RE.sub("[REDACTED_PHONE]", text)
        categories.add("phone")
    if _SEAT_RE.search(text):
        text = _SEAT_RE.sub("seat: [REDACTED]", text)
        categories.add("seat")
    if _ADMISSION_RE.search(text):
        text = _ADMISSION_RE.sub("[REDACTED_ADMISSION_CODE]", text)
        categories.add("admission_code")
    if _BEARER_RE.search(text):
        text = _BEARER_RE.sub("Bearer [REDACTED]", text)
        categories.add("bearer_token")
    if _URL_RE.search(text):
        if _URL_SECRET_RE.search(text):
            categories.add("url_access_token")
        text = _URL_RE.sub("[REDACTED_URL]", text)
        categories.add("url")
    return text.strip(), tuple(sorted(categories))


def admit_public_fields(candidate_fields: object) -> Tuple[AdmittedFacts, Tuple[str, ...]]:
    """Accept only a concrete dict of known string fields and sanitize values."""

    if type(candidate_fields) is not dict:
        raise FieldAdmissionError()
    candidates = candidate_fields
    if any(type(key) is not str or key not in _ALLOWED_FIELDS for key in candidates):
        raise FieldAdmissionError()

    sanitized: Dict[str, str] = {}
    redactions = set()
    for key, value in candidates.items():
        if type(value) is not str:
            raise FieldAdmissionError()
        value, categories = _safe_field_text(value)
        redactions.update(categories)
        if not value or len(value) > _MAX_FIELD_LENGTHS[key]:
            raise FieldAdmissionError()
        if key == "event_date":
            try:
                parsed = date.fromisoformat(value)
            except ValueError:
                raise FieldAdmissionError()
            if parsed.isoformat() != value:
                raise FieldAdmissionError()
        sanitized[key] = value

    if not sanitized:
        raise FieldAdmissionError()
    return (
        AdmittedFacts(
            event_name=sanitized.get("event_name"),
            event_date=sanitized.get("event_date"),
            venue=sanitized.get("venue"),
        ),
        tuple(sorted(redactions)),
    )


class _VisibleHTMLText(HTMLParser):
    _HIDDEN_TAGS = {"script", "style", "noscript"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._hidden_depth = 0
        self.parts = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag.lower() in self._HIDDEN_TAGS:
            self._hidden_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self._HIDDEN_TAGS and self._hidden_depth:
            self._hidden_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._hidden_depth == 0 and data.strip():
            self.parts.append(data)


def _normalize_document(document: SourceDocument) -> Tuple[Optional[str], Optional[QuarantineCode], str]:
    raw_modality = document.modality
    try:
        modality = raw_modality if isinstance(raw_modality, ContentModality) else ContentModality(raw_modality)
    except (TypeError, ValueError):
        return None, QuarantineCode.UNSUPPORTED_MODALITY, "unknown"

    if modality is ContentModality.ATTENDEE_CSV:
        return None, QuarantineCode.ATTENDEE_DATA, modality.value
    if modality in (ContentModality.IMAGE_BINARY, ContentModality.PDF_BINARY, ContentModality.UNKNOWN_BINARY):
        return None, QuarantineCode.OPAQUE_BINARY, modality.value
    if modality not in (
        ContentModality.HTML,
        ContentModality.OCR_TEXT,
        ContentModality.PDF_TEXT,
        ContentModality.PDF_METADATA,
        ContentModality.PLAIN_TEXT,
    ):
        return None, QuarantineCode.UNSUPPORTED_MODALITY, modality.value

    payload = document.payload
    if type(payload) is bytes:
        try:
            text = payload.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            return None, QuarantineCode.INVALID_UTF8, modality.value
    elif type(payload) is str:
        text = payload
    else:
        return None, QuarantineCode.UNSUPPORTED_MODALITY, modality.value

    if modality is ContentModality.HTML:
        parser = _VisibleHTMLText()
        try:
            parser.feed(text)
            parser.close()
        except Exception:
            return None, QuarantineCode.UNSUPPORTED_MODALITY, modality.value
        text = " ".join(parser.parts)

    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None, QuarantineCode.EMPTY_CONTENT, modality.value
    return text, None, modality.value


class BoundarySession:
    """Staged ingest; only `publish` creates a shareable derivative."""

    def __init__(
        self,
        context: TrustedTenantContext,
        document: SourceDocument,
        original_ref: PrivateOriginalRef,
        source_ref: str,
    ) -> None:
        self._context = context
        self._document = document
        self._original_ref = original_ref
        self._source_ref = source_ref
        self._record_id = secrets.token_urlsafe(18)
        self._state = SessionState.ACCEPTING
        self._modality = _modality_label(document.modality)
        self._quarantine_code: Optional[QuarantineCode] = None
        self._pending_facts: Optional[AdmittedFacts] = None
        self._redaction_categories: Tuple[str, ...] = ()
        self._published: Optional[SanitizedDerivative] = None

    @property
    def state(self) -> SessionState:
        return self._state

    @property
    def original_ref(self) -> PrivateOriginalRef:
        return self._original_ref

    def prepare(self, candidate_fields: object) -> SessionState:
        if self._state is SessionState.CANCELLED:
            return self._state
        if self._state is not SessionState.ACCEPTING:
            return self._state
        normalized_text, document_error, modality_label = _normalize_document(self._document)
        self._modality = modality_label
        if document_error is not None:
            self._quarantine(document_error)
            return self._state
        try:
            facts, categories = admit_public_fields(candidate_fields)
        except FieldAdmissionError:
            self._quarantine(QuarantineCode.INVALID_FIELDS)
            return self._state
        if type(candidate_fields) is not dict or normalized_text is None:
            self._quarantine(QuarantineCode.INVALID_FIELDS)
            return self._state
        normalized_source = unicodedata.normalize("NFKC", normalized_text).casefold()
        for candidate in candidate_fields.values():
            normalized_candidate = re.sub(
                r"\s+", " ", unicodedata.normalize("NFKC", candidate)
            ).strip().casefold()
            if normalized_candidate not in normalized_source:
                self._quarantine(QuarantineCode.INVALID_FIELDS)
                return self._state
        self._pending_facts = facts
        self._redaction_categories = categories
        self._state = SessionState.REDACTED
        return self._state

    def publish(self) -> BoundaryResult:
        if self._state is SessionState.PUBLISHED:
            return self._result(self._published, None)
        if self._state is SessionState.CANCELLED:
            return self._result(None, QuarantineCode.CANCELLED)
        if self._state is SessionState.QUARANTINED:
            return self._result(None, self._quarantine_code)
        if self._state is not SessionState.REDACTED or self._pending_facts is None:
            self._quarantine(QuarantineCode.NO_ADMITTED_FIELDS)
            return self._result(None, self._quarantine_code)
        provenance = EvidenceProvenance(self._source_ref, self._modality)
        derivative = SanitizedDerivative(
            record_id=self._record_id,
            provenance=provenance,
            facts=self._pending_facts,
            redaction_categories=self._redaction_categories,
            _tenant_id=self._context.tenant_id,
            _seal=_DERIVATIVE_SEAL,
        )
        self._published = derivative
        self._pending_facts = None
        self._state = SessionState.PUBLISHED
        return self._result(derivative, None)

    def cancel(self) -> None:
        if self._state is SessionState.PUBLISHED:
            return
        self._pending_facts = None
        self._published = None
        self._quarantine_code = QuarantineCode.CANCELLED
        self._state = SessionState.CANCELLED

    def result(self) -> BoundaryResult:
        if self._state is SessionState.PUBLISHED:
            return self._result(self._published, None)
        return self._result(None, self._quarantine_code)

    def _quarantine(self, code: QuarantineCode) -> None:
        self._pending_facts = None
        self._quarantine_code = code
        self._state = SessionState.QUARANTINED

    def _result(
        self,
        derivative: Optional[SanitizedDerivative],
        code: Optional[QuarantineCode],
    ) -> BoundaryResult:
        return BoundaryResult(
            record_id=self._record_id,
            state=self._state,
            modality=self._modality,
            provenance=EvidenceProvenance(self._source_ref, self._modality),
            original_ref=self._original_ref,
            derivative=derivative,
            quarantine_code=code,
            _tenant_id=self._context.tenant_id,
            _seal=_RESULT_SEAL,
        )


def _modality_label(modality: Union[ContentModality, str]) -> str:
    if isinstance(modality, ContentModality):
        return modality.value
    try:
        return ContentModality(modality).value
    except (TypeError, ValueError):
        return "unknown"


class ContentBoundary:
    def __init__(self, vault: PrivateOriginalVault) -> None:
        self._vault = vault

    def begin(self, context: TrustedTenantContext, document: SourceDocument) -> BoundarySession:
        _require_context(context)
        if not isinstance(document, SourceDocument):
            raise ValueError("source document required")
        if type(document.payload) not in (str, bytes):
            raise ValueError("unsupported private payload type")
        source_ref = secrets.token_urlsafe(18)
        original_ref = self._vault._store(context, document, source_ref)
        return BoundarySession(context, document, original_ref, source_ref)

    def restart(self, context: TrustedTenantContext, original_ref: PrivateOriginalRef) -> BoundarySession:
        entry = self._vault._entry_for_retry(context, original_ref)
        document = SourceDocument(
            modality=entry.modality,
            payload=entry.payload,
            external_reference=entry.external_reference,
        )
        return BoundarySession(context, document, original_ref, entry.source_ref)


def safe_diagnostics(result: BoundaryResult) -> Dict[str, object]:
    """Return only fixed codes and generated identifiers, never source values."""

    if not isinstance(result, BoundaryResult) or result._seal is not _RESULT_SEAL:
        raise ValueError("boundary result required")

    return {
        "record_id": result.record_id,
        "state": result.state.value,
        "modality": result.modality,
        "trust": result.provenance.trust.value,
        "source_ref": result.provenance.source_ref,
        "reason_code": result.quarantine_code.value if result.quarantine_code else None,
        "redaction_categories": list(result.derivative.redaction_categories) if result.derivative else [],
    }
