"""Fail closed before dispatching any owner runner or paid provider boundary."""

from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

from integration_evals.models import Case, Mode, Provider


@dataclass(frozen=True, slots=True)
class Blocker:
    """A missing prerequisite with an actionable owning boundary."""

    owner: str
    reason: str


@dataclass(frozen=True, slots=True)
class PreflightContext:
    """Runtime authority and platform inputs kept outside provider evidence."""

    mode: Mode
    environment: Mapping[str, str]
    platform: str
    authorize_paid: bool


def provider_blocker(
    provider: Provider,
    operations: tuple[str, ...],
    environment: Mapping[str, str],
    *,
    authorize_paid: bool,
) -> Blocker | None:
    """Check authority and credential presence; never return credential values."""
    if provider.mode in {Mode.MOCK, Mode.RECORDED}:
        return None
    conditions = (
        (
            not authorize_paid or not provider.authority_ref,
            "explicit current budget authority required",
        ),
        (not provider.eligible, "account eligibility unverified"),
        (
            not provider.credential_env or not environment.get(provider.credential_env),
            "credential unavailable",
        ),
        (not provider.cap or not provider.currency, "approved positive cap and currency required"),
        (
            not provider.endpoint or urlsplit(provider.endpoint).scheme != "https",
            "owner-approved HTTPS endpoint required",
        ),
        (not provider.cleanup_supported, "bounded cleanup unsupported"),
        (
            not set(operations).issubset(provider.allowed_operations),
            "operation outside authorized allowlist",
        ),
    )
    for missing, reason in conditions:
        if missing:
            return Blocker(provider.id, reason)
    return None


def case_blocker(
    case: Case, providers: tuple[Provider, ...], context: PreflightContext
) -> Blocker | None:
    """Keep mode, platform and per-provider prerequisites independent."""
    if context.mode not in case.modes:
        return Blocker(case.component, "execution mode unsupported by case")
    if case.platform not in {"any", context.platform}:
        return Blocker(case.component, "required target platform unavailable")
    configured = {provider.id: provider for provider in providers}
    for provider_id in case.provider_ids:
        provider = configured.get(provider_id)
        if provider is None:
            return Blocker(provider_id, "provider preflight configuration missing")
        if context.mode in {Mode.MOCK, Mode.RECORDED} and provider.mode not in {
            Mode.MOCK,
            Mode.RECORDED,
        }:
            return Blocker(provider_id, "offline run cannot dispatch real provider mode")
        blocker = provider_blocker(
            provider, case.operations, context.environment, authorize_paid=context.authorize_paid
        )
        if blocker is not None:
            return blocker
    return None
