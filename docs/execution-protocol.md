# Verification execution protocol

## Decision and ownership

The evaluator is a thin verifier over the integration workspace owned by
getticketstub.com. It does not implement product services, approval issuance,
financial postings, JEV transport, image adapters, or canonical product schemas.
The app supplies the composed release; shared-contracts supplies published contracts
and compatibility fixtures; cost-intelligence supplies financial expected outputs.

Local/CI context is independent from mock-only, recorded, sandbox, or live transport.
CI context is selected by the standard `CI=true` environment. Runs retain each provider's
configured mode. The evaluation record schemas in `schemas/` describe evaluator
records only and are never substituted for shared-contracts schemas.

## Manifest and actual checkout verification

Pass `--manifest` a JSON Assembly record accepted by the Python model in
`src/integration_evals/models.py`. It has:

- schema_version 1.0 and owner getticketstub.com;
- full 40-character integration revision and component commit/tree pins;
- each component's repository name, lockfile path/digest, owner command array,
  and cleanup command array;
- the canonical contract artifact digest, fixture catalog digest, runtime string,
  configuration digest, and per-provider settings.

The required initial release includes app, shared-contracts, harness, research,
creative, finance, and this evaluator. Every additionally consumed component must
appear too. The evaluator validates HEAD, tree, working-copy cleanliness and exact
lockfile bytes against existing supplied checkouts; it does not resolve main/latest,
rewrite foreign sources, or regard an open PR as an accepted release.
Catalog identity is SHA-256 of Catalog.model_dump_json() UTF-8 bytes; schema pins and
lockfiles address exact artifact bytes. Run receipts also retain actual source content
fingerprints, including uncommitted local work. A composed product run rejects a dirty
or differently pinned evaluator.

## Owner command protocol

Each owner supplies a reviewed command array executed without a shell in its pinned
checkout. It reads one JSON request from stdin containing the case, run ID, isolated
namespace, seed, fixed injected clock, and sanitized provider configuration.
The case declares the fault hook, interface, fixture IDs, allowed modes, operations,
observation names and expected invariants. The owner must resolve the agreed fixtures
and use its actual public interfaces/fault hooks. Missing support blocks that boundary.

Return one OwnerResponse JSON record on stdout: actual component revision,
execution mode, artifact origin, named observed scalar values, actual evidence
records, and cost amount/status. Missing observations fail; booleans cannot masquerade
as numeric counters. Missing evidence prevents success. Exact output hashes and
owner-produced revisions/permissions must join the run/case/requirement records.
Output parsing is size-bounded and raw private stdout/stderr is withheld from public
reports. Exit status, output digest, duration and cleanup status are retained.

The cleanup command receives the same request and environment and is attempted in a
finally path, with a bounded timeout. Failed or uncertain cleanup makes the case an
error. Temporary homes/directories and tenant/project namespace values are distinct
for every run/case. The clock/seed are explicit and deterministic; owners synchronize
concurrency faults through their own barrier hooks. No fixed sleeps are used.

## Offline enforcement and real modes

Offline children receive only PATH/SYSTEMROOT and evaluator isolation variables.
Unrelated secrets and user home configuration are not inherited. OS enforcement denies
network access using sandbox-exec on macOS or a Bubblewrap network namespace on Linux.
Missing enforcement is blocked, and failed namespace setup is an execution error.
This is verification-runner isolation, not evidence that a producer's SSRF boundary
works. The registry's SSRF egress case requires Linux and actual producer observations.

Real modes additionally require boolean credential presence, owner-approved endpoint,
eligible account, current authority reference, positive cap/currency, operation allowlist
and cleanup. The owner remains responsible for authoritative reservations, admission,
attempt metering and cap enforcement. The evaluator does not create a competing ledger.
No real purchase, payment, customer message, deployment or publication is authorized by
this tooling. Genuine GPT Image, JEV, Neatlogs, Entire and CFO.ai evidence must come from
their owners; a local fake server or synthetic object is insufficient.

## Fixtures and permission handling

`fixtures/catalog.json` records origin, collection date, permission basis, tenant scope,
redaction, retention/revocation, requirements, expected behavior and supported modes.
The checked-in bytes are fictional original test inputs using reserved domains.
Hostile SVG is stored as quarantined text and is never rendered during validation.
Revoked inputs require a retained digest tombstone and quarantine rather than loss
of audit history. A synthetic approval reference is input data, never runtime authority.

An explicit `initialize` invocation refreshes provenance/hash records from reviewed
checked-in fixture bytes and imports a captured GitHub issue inventory. Inspect its
diff before accepting fixture changes; ordinary validation never regenerates hashes.
Restricted original artifacts remain in owner-approved private storage. Only permission
and redaction-reviewed accessible derivatives belong in this repository's public evidence.

## Benchmark and promotion constraints

Raw Sample records retain candidate, revision, configuration digest, trial, mode,
prediction/abstention, latency, cost and downstream-cost uncertainty.
The benchmark computes per-question/stratum macro-F1, precision/recall, critical misses,
abstention/coverage, p50/p95 latency and known costs. Cost per success is absent while
any required cost is unknown. A deterministic paired family bootstrap reports an
accuracy-difference 95% interval; it does not claim an F1 or cost interval.

The corpus validator rejects duplicate IDs, missing provenance and family/content
leakage between calibration and held-out splits. Proposed EI minimums are 120 calibration,
240 held-out and 20 held-out per required question; the current smoke corpus fails them.
Original EI multilingual and creative routing/inspection targets remain additional
owner obligations in IE-06A/06B. Independent labels/adjudication and ratified numeric
quality, latency, cost, abstention and uncertainty rules are prerequisites.
No tuning is permitted on final held-out labels. Mock/replay statistics cannot promote
live routing. Complete owner-supplied policy and required-mode receipts remain blocked.

## Results, reruns and authoritative tracker updates

Reports keep execution passed/failed/skipped/error separate from criterion state and
artifact origin. Skipped mandatory boundaries stay blocked. Unknown costs remain unknown.
Every saved run uses an exclusive new directory; a later pass cannot overwrite failure.
JSON, JUnit, human reports, coverage and release audits preserve linked blockers.
P1 BUD-04 and Production LIVE-01–03 remain explicit exclusions with their original states.

Diagnostic reruns have parent IDs, rationale and attempt index; at most two are allowed
with unchanged release/source/catalog/config/seed/clock/selection fingerprints.
Safety failures, real-provider executions and ambiguous dispatch are not eligible for
automatic retries. Flake records require an owner, remediation issue, denominator,
good/bad revisions, signature, quarantine expiry and reproduction command.
Quarantined mandatory cases remain blocked. Stochastic benchmark variation is reported
as raw repeated trials and statistics, separately from infrastructure flakes.

The master acceptance files are preserved. An owner/reviewer must review authentic
current evidence and exact component revisions before changing their states, preserving
ID, priority, ownership, original verification text and original evidence requirements
in both JSON and Markdown. Neither issue closure nor model review updates acceptance.

## Current unresolved obligations

The per-run release-audit.json lists every exact leaf AC from all 21 launch issues and
every original P0 criterion. Repository tooling readiness is partial; integrated product
acceptance is blocked. No launch issue is represented as closed or complete.

Required inputs include published canonical schemas/fixtures, the app's actual release
manifest and approval verifier, owner runner/fault/cleanup interfaces for each boundary,
financial expected outputs/projections, browser journey evidence, Linux producer egress
observations, independently adjudicated held-out corpora, ratified policy, genuine provider
credentials/budgets/receipts, and accessible Neatlogs/Entire/CFO.ai artifacts.
The declared observation protocol must be accepted by the producer owners before
conformance or real integration can be claimed. Separate repository tests cannot establish
that the composed release works.
