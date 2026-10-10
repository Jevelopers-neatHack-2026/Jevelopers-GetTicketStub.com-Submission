# event-intelligence

Sourced event facts and research cache.

## Implementation status

This repository contains an internal, bounded HTTP(S) retrieval utility under `src/security/`, a content privacy boundary and tenant-scoped flows under `src/privacy/`, deterministic local DNS/HTTP/TLS and privacy fixtures, a Node 22 test runner, and compile-checked consumer declarations. Retrieval validates URL and DNS policy, pins connections to vetted addresses, revalidates redirects, bounds response resources, and rejects unsupported or mismatched media. Privacy flows keep untrusted content quarantined until a configured trusted review approves the public facts.

The utility is not yet integrated with the accepted research request/response contract. EI-01 (#7) and EI-09 (#9) remain prerequisites. Event source discovery, factual extraction, provenance, caching, provider connections, downstream parser hardening, and live release evidence remain pending. The local socket fixtures measure their own requests only; they do not assert production or external egress telemetry.

Run `npm ci`, `make verify CASE=safe-retrieval MODE=mock`, `make verify CASE=content-privacy MODE=mock`, `make verify CASE=eval-policy-unit MODE=unit`, `npm run test:runner`, and `npm run typecheck` with Node 22.23.3 and Python 3.9 or newer (CI pins Python 3.11.17). The Python route emits the actual Python runtime and expected, executed, passed, failed, and skipped `unittest` counts, and fails when no tests execute or any case fails, skips, or unexpectedly succeeds. It covers local policy and runner unit tests only; it is not the held-out benchmark or evidence that the policy is promotion-ready. The reserved Node `CASE=evals MODE=mock` route remains fail-closed until a benchmark suite is implemented. Details and limits are in [controlled retrieval](docs/security/controlled-retrieval.md) and [content privacy boundary](docs/privacy/content-boundary.md). These checks use local fixtures; they perform no application deployment, provider connection, or live retrieval.

[Architecture reference](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [Implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)

## Architecture and delivery

- [Repository responsibilities and interfaces](docs/architecture/OWNERSHIP.md)
- [Relevant acceptance criteria](docs/architecture/ACCEPTANCE.md)
- [Architecture and diagrams](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md)
- [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md)

Architecture integration documents the intended boundaries. It does not establish completed product functionality, passing implementation tests, connected sponsor tools, or live financial activity.
