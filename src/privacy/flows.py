"""Small internal adapters that keep only sanitized derivatives downstream."""

from __future__ import annotations

import hashlib
import hmac
import json
import threading
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .boundary import (
    _DERIVATIVE_SEAL,
    _RESULT_SEAL,
    BoundaryResult,
    PrivateEvidenceUnavailable,
    SanitizedDerivative,
    SessionState,
    TrustedTenantContext,
    safe_diagnostics,
)


_TELEMETRY_SEAL = object()
_FLOW_OUTPUT_SEAL = object()


class TenantDerivativeCache:
    """Tenant-partitioned cache that accepts sanitized derivatives only."""

    def __init__(self) -> None:
        self._values: Dict[Tuple[str, str], SanitizedDerivative] = {}
        self._lock = threading.RLock()

    def put(self, context: TrustedTenantContext, key: str, derivative: SanitizedDerivative) -> None:
        _require_context(context)
        if type(key) is not str or not key or len(key) > 180:
            raise ValueError("cache key required")
        if (
            not isinstance(derivative, SanitizedDerivative)
            or derivative._seal is not _DERIVATIVE_SEAL
            or derivative._tenant_id != context.tenant_id
        ):
            raise PrivateEvidenceUnavailable()
        with self._lock:
            self._values[(context.tenant_id, key)] = derivative

    def get(self, context: TrustedTenantContext, key: str) -> Optional[SanitizedDerivative]:
        _require_context(context)
        if type(key) is not str:
            return None
        with self._lock:
            return self._values.get((context.tenant_id, key))

    def snapshot(self, context: TrustedTenantContext) -> Tuple[SanitizedDerivative, ...]:
        """Inspection hook returns only the caller's sanitized partition."""
        _require_context(context)
        with self._lock:
            return tuple(
                derivative
                for (tenant_id, _), derivative in self._values.items()
                if tenant_id == context.tenant_id
            )


def _require_context(context: TrustedTenantContext) -> None:
    if not isinstance(context, TrustedTenantContext):
        raise ValueError("trusted tenant context required")


@dataclass(frozen=True)
class TelemetryRecord:
    tenant_key: str
    record_id: str
    state: str
    modality: str
    trust: str
    reason_code: Optional[str]
    redaction_categories: Tuple[str, ...]
    _tenant_id: str = field(repr=False)
    _seal: object = field(repr=False, compare=False)


class TenantTelemetry:
    """Tenant-keyed, value-free diagnostics built from boundary result codes."""

    def __init__(self, tenant_key: bytes) -> None:
        if type(tenant_key) is not bytes or len(tenant_key) < 16:
            raise ValueError("telemetry tenant key must contain at least 16 bytes")
        self._tenant_key_bytes = tenant_key
        self._records: List[TelemetryRecord] = []
        self._lock = threading.RLock()

    def _tenant_key(self, context: TrustedTenantContext) -> str:
        return hmac.new(
            self._tenant_key_bytes,
            context.tenant_id.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def record(self, context: TrustedTenantContext, result: BoundaryResult) -> TelemetryRecord:
        _require_context(context)
        if (
            not isinstance(result, BoundaryResult)
            or result._seal is not _RESULT_SEAL
            or result._tenant_id != context.tenant_id
        ):
            raise PrivateEvidenceUnavailable()
        diagnostic = safe_diagnostics(result)
        keyed_tenant = self._tenant_key(context)
        record = TelemetryRecord(
            tenant_key=keyed_tenant,
            record_id=str(diagnostic["record_id"]),
            state=str(diagnostic["state"]),
            modality=str(diagnostic["modality"]),
            trust=str(diagnostic["trust"]),
            reason_code=diagnostic["reason_code"],
            redaction_categories=tuple(diagnostic["redaction_categories"]),
            _tenant_id=context.tenant_id,
            _seal=_TELEMETRY_SEAL,
        )
        with self._lock:
            self._records.append(record)
        return record

    def snapshot(self, context: TrustedTenantContext) -> Tuple[TelemetryRecord, ...]:
        _require_context(context)
        tenant_key = self._tenant_key(context)
        with self._lock:
            return tuple(record for record in self._records if record.tenant_key == tenant_key)


@dataclass(frozen=True)
class DecisionState:
    record_id: str
    facts: Tuple[Tuple[str, str], ...]
    source_ref: str
    modality: str
    trust: str
    _tenant_id: str = field(repr=False)
    _seal: object = field(repr=False, compare=False)

    def as_payload(self, context: TrustedTenantContext) -> Dict[str, object]:
        _require_context(context)
        if self._seal is not _FLOW_OUTPUT_SEAL or self._tenant_id != context.tenant_id:
            raise PrivateEvidenceUnavailable()
        return {
            "record_id": self.record_id,
            "facts": dict(self.facts),
            "provenance": {
                "source_ref": self.source_ref,
                "modality": self.modality,
                "trust": self.trust,
            },
        }


@dataclass(frozen=True)
class CreativePayload:
    record_id: str
    event_facts: Tuple[Tuple[str, str], ...]
    evidence_ref: str
    evidence_modality: str
    evidence_trust: str
    _tenant_id: str = field(repr=False)
    _seal: object = field(repr=False, compare=False)

    def as_payload(self, context: TrustedTenantContext) -> Dict[str, object]:
        _require_context(context)
        if self._seal is not _FLOW_OUTPUT_SEAL or self._tenant_id != context.tenant_id:
            raise PrivateEvidenceUnavailable()
        return {
            "record_id": self.record_id,
            "event_facts": dict(self.event_facts),
            "evidence": {
                "source_ref": self.evidence_ref,
                "modality": self.evidence_modality,
                "trust": self.evidence_trust,
            },
        }


def _require_derivative(context: TrustedTenantContext, derivative: SanitizedDerivative) -> None:
    _require_context(context)
    if (
        not isinstance(derivative, SanitizedDerivative)
        or derivative._seal is not _DERIVATIVE_SEAL
        or derivative._tenant_id != context.tenant_id
    ):
        raise PrivateEvidenceUnavailable()


def make_decision_state(
    context: TrustedTenantContext,
    derivative: SanitizedDerivative,
) -> DecisionState:
    _require_derivative(context, derivative)
    return DecisionState(
        record_id=derivative.record_id,
        facts=tuple(sorted(derivative.facts.as_dict().items())),
        source_ref=derivative.provenance.source_ref,
        modality=derivative.provenance.modality,
        trust=derivative.provenance.trust.value,
        _tenant_id=context.tenant_id,
        _seal=_FLOW_OUTPUT_SEAL,
    )


def make_creative_payload(
    context: TrustedTenantContext,
    derivative: SanitizedDerivative,
) -> CreativePayload:
    _require_derivative(context, derivative)
    return CreativePayload(
        record_id=derivative.record_id,
        event_facts=tuple(sorted(derivative.facts.as_dict().items())),
        evidence_ref=derivative.provenance.source_ref,
        evidence_modality=derivative.provenance.modality,
        evidence_trust=derivative.provenance.trust.value,
        _tenant_id=context.tenant_id,
        _seal=_FLOW_OUTPUT_SEAL,
    )


def serialize_flow_outputs(
    context: TrustedTenantContext,
    cache_values: Tuple[SanitizedDerivative, ...],
    telemetry_values: Tuple[TelemetryRecord, ...],
    decisions: Tuple[DecisionState, ...],
    creative: Tuple[CreativePayload, ...],
) -> str:
    """Stable serialization helper for leak scans and fixture handoffs."""
    _require_context(context)
    if any(
        not isinstance(value, SanitizedDerivative)
        or value._seal is not _DERIVATIVE_SEAL
        or value._tenant_id != context.tenant_id
        for value in cache_values
    ):
        raise PrivateEvidenceUnavailable()
    if any(
        not isinstance(record, TelemetryRecord)
        or record._seal is not _TELEMETRY_SEAL
        or record._tenant_id != context.tenant_id
        for record in telemetry_values
    ):
        raise PrivateEvidenceUnavailable()
    for value in decisions:
        value.as_payload(context)
    for value in creative:
        value.as_payload(context)
    return json.dumps(
        {
            "cache": [
                {
                    "record_id": value.record_id,
                    "facts": value.facts.as_dict(),
                    "provenance": {
                        "source_ref": value.provenance.source_ref,
                        "modality": value.provenance.modality,
                        "trust": value.provenance.trust.value,
                    },
                }
                for value in cache_values
            ],
            "telemetry": [
                {
                    "tenant_key": record.tenant_key,
                    "record_id": record.record_id,
                    "state": record.state,
                    "modality": record.modality,
                    "trust": record.trust,
                    "reason_code": record.reason_code,
                    "redaction_categories": record.redaction_categories,
                }
                for record in telemetry_values
            ],
            "decisions": [value.as_payload(context) for value in decisions],
            "creative": [value.as_payload(context) for value in creative],
        },
        sort_keys=True,
    )
