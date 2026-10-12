# Components, status and checks

This page lists the internal components in this repository, what is still pending, and how each is verified. It holds the detail that the [root README](../README.md) summarizes. Every component here is private or internal. None of them is the accepted public research request/response API, and none establishes full issue acceptance.

## Component inventory

| Component | Source | Reference | Requirement / issue |
| --- | --- | --- | --- |
| Controlled HTTP(S) retrieval | `src/security/` | [Controlled retrieval](security/controlled-retrieval.md) | EI-02 [#8](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/8); EI-01 #7 and EI-09 #9 integration outstanding |
| Content privacy boundary and tenant-scoped flows | `src/privacy/`, `src/security/content-boundary/` | [Content privacy boundary](privacy/content-boundary.md) | EI-09 [#9](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/9) |
| Deterministic source extraction | `src/extraction/` | [Deterministic extraction](extraction/README.md) | Internal partial component |
| Text-PDF reader | `src/extraction/pdf/` | [Internal text-PDF reader](extraction/text-pdf.md) | Internal partial component |
| Evidence storage and provenance | `src/evidence/`, `src/verification/provenance/` | [Evidence and provenance store](evidence/provenance-store.md) | Contributes to [#10](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/10) |
| Private source-to-identity composition | `src/discovery/identity/` | [Source identity](discovery/source-identity.md) | EI-04 [#14](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/14) |
| Entity and occurrence identity | `src/discovery/entities/`, `src/discovery/occurrences/` | [Occurrence identity](discovery/occurrence-identity.md) | EI-04 |
| Bounded source frontier | `src/discovery/planner/` | [Bounded frontier](discovery/bounded-frontier.md) | EI-04 [#14](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/14) |
| Private retrieval lifecycle | `src/research/private-retrieval.mjs` | [Private retrieval lifecycle](discovery/private-retrieval.md) | Internal partial component; no public research API |
| Immutable correction history | `src/review/history/` | [Immutable history](review/immutable-history.md) | EI-10 |
| Scoped reuse cache | `src/cache/reuse/` | [Scoped reuse](cache/scoped-reuse.md) | EI-11 |
| JEV question registry and preparation | `src/decisions/questions/` | [Question registry](decisions/question-registry.md) | [#16](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/16), [#17](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/17), [#18](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/18) |
| Asset source discovery | `src/brand-research/` | [Asset source discovery](brand-research/asset-source-discovery.md) | Private store path |
| Safe asset byte inspection | `src/security/assets/` | [Safe assets](security/safe-assets.md) | EI-08 |
| Asset permission selection | `src/verification/asset-permissions/` | [Asset permissions](security/asset-permissions.md) | EI-08 |
| JEV promotion policy and offline projection | `evals/` | [JEV promotion](decisions/jev-promotion.md), [offline normalized results](evals/offline-normalized-results.md) | Proposed; owner decisions pending |
| Handoff artifact checker | `tools/verify_handoff.py` | [Handoff checker](contracts/handoff-checker.md) | EI-X01 to EI-X04 |

Retrieval validates URL and DNS policy, pins connections to vetted addresses, revalidates redirects, bounds response resources, and rejects unsupported or mismatched media. Privacy flows keep untrusted content quarantined until a configured trusted review approves the public facts. The text-PDF reader derives bounded, incomplete page/text observations from supplied bytes; scanned and mixed pages still require inspection.

The repository also contains deterministic local DNS/HTTP/TLS and privacy fixtures, a Node 22 test runner, and compile-checked consumer declarations.

## Pending

These remain pending and are not provided by any component above:

- Public research API integration
- Complete source traversal and canonical fact selection
- Provider connections, live retrieval and release evidence
- Finance/billing validation
- Production-host containment
- Full screenshot and scanned-PDF inspection

The local socket fixtures measure their own requests only; they do not assert production or external egress telemetry. The cross-repository handoffs are described in [research contract](contracts/research-contract-handoff.md), [metering, budget and trace](contracts/metering-budget-trace-handoff.md), [provider readiness](providers/readiness-handoff.md) and [consumer](contracts/consumer-handoff.md) handoffs.

## Verification routes

`make verify CASE=<case> MODE=<mode>` runs [`tools/verify.mjs`](../tools/verify.mjs). It requires Node 22, runs the collected test files one at a time in separate processes, and prints a `VERIFY_SUMMARY_JSON=` line. A route fails unless every collected test ran and passed with none skipped.

| Case | Mode | Runs |
| --- | --- | --- |
| `safe-retrieval` | `mock` | `tests/security` |
| `content-privacy` | `mock` | `tests/privacy`, `tests/security/injection` |
| `evidence-facts` (alias `evidence`) | `mock` | `tests/evidence` |
| `deterministic-extraction` | `mock` | `tests/extraction` |
| `asset-source-discovery` | `mock` | `tests/brand-research`, `tests/integration/asset-source/core` |
| `verify-runner` | `mock` | `tests/runner` |
| `eval-policy-unit` | `unit` | Python suites listed in [`tools/run_python_tests.py`](../tools/run_python_tests.py) |
| `pdf-derived-evidence` | `linux-integration` | `tests/evidence`, `tests/extraction/pdf`, `tests/integration/pdf-evidence`; Linux only |
| `asset-source-discovery-linux` | `linux-integration` | `tests/integration/asset-source/linux`; Linux only |
| `research-api` | `mock` | `tests/api/research-contract-v1`; [offline pinned candidate compatibility](contracts/research-contract-candidate-v1.md), not public API acceptance |
| `evals` | `mock` | Reserved. No Node test files exist yet, so this fails closed |

The two `linux-integration` routes fail on other platforms instead of counting as passed. `MODE=live` is accepted by the argument parser but always fails: live mode is disabled until an adapter and accepted EI-01/EI-09 integration exist, and no request is attempted.

The `research-api` route uses the older copied shared-contracts candidate and synthetic fixtures. The separate opt-in [installed 0.9.7 consumer diagnostic](contracts/installed-research-consumer-0.9.7.md) verifies an owner-pinned archive before exercising actual local correction-store outputs and independent synthetic canonical controls. It is invoked through its documented launcher, not this `make verify` route. Its expected incompatibility result remains `INCOMPATIBLE_HOLD`; neither check establishes an accepted public research API or canonical mapping.

The `eval-policy-unit` Python route emits the actual Python runtime and expected, executed, passed, failed, skipped-case, and total skip-event counts; it separately identifies subtest and setup/teardown hook skips and errors. It fails when no tests execute or any case fails, any skip event occurs, or any test unexpectedly succeeds. It covers local policy and runner unit tests only; it is not the held-out benchmark or evidence that the policy is promotion-ready.

## CI workflows

All Node workflows use Node 22.23.3 and run `npm ci` and `node tools/install-typescript-host.mjs` first. Python steps use Python 3.11.17.

| Workflow | Main checks |
| --- | --- |
| [`verify.yml`](../.github/workflows/verify.yml) | 31 handoff checker tests; `eval-policy-unit`, `safe-retrieval`, `content-privacy`; `npm run test:runner`; `npm run typecheck` |
| [`extraction.yml`](../.github/workflows/extraction.yml) | `deterministic-extraction`; typecheck |
| [`evidence.yml`](../.github/workflows/evidence.yml) | `evidence-facts`; typecheck |
| [`selected-evidence.yml`](../.github/workflows/selected-evidence.yml), [`source-identity.yml`](../.github/workflows/source-identity.yml) | Evidence, extraction and identity tests together |
| [`text-pdf.yml`](../.github/workflows/text-pdf.yml), [`pdf-derived-evidence.yml`](../.github/workflows/pdf-derived-evidence.yml) | PDF reader tests; `pdf-derived-evidence` on Linux |
| [`asset-source-discovery.yml`](../.github/workflows/asset-source-discovery.yml), [`safe-assets.yml`](../.github/workflows/safe-assets.yml), [`asset-permissions.yml`](../.github/workflows/asset-permissions.yml) | Asset discovery, inspection and permission tests |
| [`occurrence-identity.yml`](../.github/workflows/occurrence-identity.yml), [`bounded-frontier.yml`](../.github/workflows/bounded-frontier.yml) | Discovery tests and consumer type checks |
| [`immutable-history.yml`](../.github/workflows/immutable-history.yml), [`scoped-reuse.yml`](../.github/workflows/scoped-reuse.yml), [`question-registry.yml`](../.github/workflows/question-registry.yml) | Component tests and consumer type checks |
| [`offline-eval-projection.yml`](../.github/workflows/offline-eval-projection.yml) | Offline projection unit tests |

These checks use local fixtures. They perform no application deployment, provider connection or live retrieval.
