"""Deterministic action authorization independent of external evidence classifiers."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import FrozenSet, Optional


class DenialReason(Enum):
    CAPABILITY_NOT_ALLOWED = "capability_not_allowed"
    BUDGET_LIMIT_EXCEEDED = "budget_limit_exceeded"
    APPROVAL_NOT_VALID = "approval_not_valid"


@dataclass(frozen=True)
class TrustedActionPolicy:
    """Immutable constraints supplied by an app-owned authority adapter.

    This is not an approval contract or financial ledger. External evidence,
    browser identifiers and classifier results cannot populate this snapshot.
    """

    allowed_capabilities: FrozenSet[str]
    max_billable_units: int
    approval_required_capabilities: FrozenSet[str]
    approved_capabilities: FrozenSet[str]

    def __post_init__(self) -> None:
        for name in ("allowed_capabilities", "approval_required_capabilities", "approved_capabilities"):
            value = getattr(self, name)
            if type(value) is not frozenset or any(type(item) is not str or not item for item in value):
                raise ValueError("policy sets must be frozen sets of non-empty strings")
        if type(self.max_billable_units) is not int or self.max_billable_units < 0:
            raise ValueError("non-negative trusted budget limit required")
        if not self.approved_capabilities.issubset(self.allowed_capabilities):
            raise ValueError("approved capabilities must also be allowed")


@dataclass(frozen=True)
class ActionRequest:
    capability: str
    billable_units: int

    def __post_init__(self) -> None:
        if type(self.capability) is not str or not self.capability:
            raise ValueError("capability required")
        if type(self.billable_units) is not int or self.billable_units < 0:
            raise ValueError("non-negative billable units required")


@dataclass(frozen=True)
class AuthorizationDecision:
    allowed: bool
    denial_reason: Optional[DenialReason] = None


def authorize_action(policy: TrustedActionPolicy, request: ActionRequest) -> AuthorizationDecision:
    """Check trusted constraints; no content or classifier input is accepted."""

    if not isinstance(policy, TrustedActionPolicy) or not isinstance(request, ActionRequest):
        raise ValueError("trusted policy and typed action request required")
    if request.capability not in policy.allowed_capabilities:
        return AuthorizationDecision(False, DenialReason.CAPABILITY_NOT_ALLOWED)
    if request.billable_units > policy.max_billable_units:
        return AuthorizationDecision(False, DenialReason.BUDGET_LIMIT_EXCEEDED)
    if (
        request.capability in policy.approval_required_capabilities
        and request.capability not in policy.approved_capabilities
    ):
        return AuthorizationDecision(False, DenialReason.APPROVAL_NOT_VALID)
    return AuthorizationDecision(True)


def optional_injection_signal(text: str, classifier: object) -> Optional[bool]:
    """Annotation only: absent, failed, or malformed classifiers return None."""

    if type(text) is not str or not callable(classifier):
        return None
    try:
        result = classifier(text)
    except Exception:
        return None
    return result if type(result) is bool else None
