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

The contract artifact path is relative to shared-contracts. The configuration artifact
path/component identifies actual immutable configuration bytes; its digest is enforced.
The runtime string must exactly match the executing interpreter's sys.version value.
An owner must separately supply runtime evidence for its own non-Python toolchain.

For an independent producer slice, use kind component, its actual owner name, and a
nonempty selected_cases list. Include shared-contracts, integration-evals and the selected
boundary's actual dependency closure. Unselected declared cases stay planned/skipped.
The public exit code evaluates the explicit selection; the release audit still records
the full unresolved program. A component-scoped run cannot establish composed acceptance.
Full composed manifests remain app-owned and require the complete assembly.

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

The request supplies a writable artifact_directory and IE_ARTIFACT_DIR. Evidence paths
are relative to this staging directory. Only exact-run/case/requirement/producer joins,
required evidence kinds and compatible real-origin claims are accepted. Sanitized,
hash-checked bytes are copied to a durable run/case namespace before owner cleanup.
Reports include those bytes and a suite snapshot. The inspect command requires the
independently trusted suite (defaults to scenarios/suite.json, or pass --suite from the
reviewed pinned checkout). Its digest must match the run. Producer, required-kind and
real-origin predicates are identical to execution. A freely edited archive snapshot is
not an independent trust anchor.
Invocation and cleanup each own a new process session. Linux uses a PID namespace in
every transport mode, so detached children are terminated when the namespace exits.
macOS prohibits process creation inside every owner/cleanup invocation; owners requiring
subprocesses must use the Linux execution environment. Unsupported containment fails closed.

The cleanup command receives the same request and environment and is attempted in a
finally path, with a bounded timeout. Failed or uncertain cleanup makes the case an
error. Temporary homes/directories and tenant/project namespace values are distinct
for every run/case. The clock/seed are explicit and deterministic; owners synchronize
concurrency faults through their own barrier hooks. No fixed sleeps are used.

### Evidence timestamps (schema 1.0)

Keep source fixture collection/provenance timestamps, actual wall-clock capture times
(where known), and the frozen injected scenario clock distinct. A fixture's immutable
`collected_at` describes that fixture; it does not set the cutoff for new output.

For newly generated synthetic, mock-only operation traces or rejection evidence, the
current v1 convention is `original_cutoff = request.clock`. Existing synthetic producers
also use `created_at = request.clock`. These are logical scenario timestamps, not claims
of actual capture time. Label that distinction explicitly in the evidence's `limitations`
and provenance. Preserve the original fixture's `collected_at` and any supplement's
actual provenance timestamps; this convention does not authorize backdating or rewriting
historical evidence.

Replay or source-derived recorded/live evidence must preserve the genuinely supplied
original cutoff and provenance from its source, snapshot or configuration. Do not infer
that cutoff from the scenario clock or fixture collection date because synthetic examples
use equal values. If its authentic meaning or value is unavailable, the broader source/live
handoff remains blocked rather than inventing a timestamp.

`Evidence` requires `created_at` and `original_cutoff`; the current timestamp validation
in `output_evidence.py` checks timezone awareness only. It does not enforce provenance,
equality with the scenario clock or `collected_at`, or temporal eligibility. Stronger
source-bound or temporal rules remain external agreed-contract and provenance requirements,
not newly implemented checks. This clarification establishes no official coding cutoff,
source publication date, sourcing deadline, billing/approval validity or hackathon-window
eligibility, and changes no historical evidence semantics.

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
accuracy-difference 95% interval using every paired row/trial; family bootstrap samples
retain all correlated trials and variants together. It does not claim an F1 or cost interval.

The corpus validator rejects duplicate IDs, missing provenance and family/content
leakage between calibration and held-out splits. Proposed EI minimums are 120 calibration,
240 held-out and 20 held-out per required question; the current smoke corpus fails them.
Original EI multilingual and creative routing/inspection targets remain additional
owner obligations in IE-06A/06B. Independent labels/adjudication and ratified numeric
quality, latency, cost, abstention and uncertainty rules are prerequisites.
No tuning is permitted on final held-out labels. Mock/replay statistics cannot promote
live routing. Complete owner-supplied policy and required-mode receipts remain blocked.

Promotion now requires frozen candidate/question/model/configuration bindings and an
approved receipt root. Every sample needs an exact receipt digest whose parsed owner
record agrees on row, trial, input bytes, model, revision, mode, timestamp, prediction,
latency and costs. A nonempty receipt string cannot establish eligibility. Ratified
NumericRules provide actual minimum samples/families, paired-family accuracy interval
width/lower bound, safety rows, and a complete mandatory metric register. Missing rules
stay blocked; reference prose is not executed as policy. Required numeric values remain
owner inputs. Use benchmark --policy <file> --receipt-root <approved-directory> to apply them.

scenarios/selection.json is an independent mandatory declaration registry. Empty suites
and deletion of mandatory cases fail before dispatch. Explicitly selected component
subsets retain all other declared criteria as planned, never passing them implicitly.

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

## Canonical candidate conformance

The contracts command consumes the actual pinned shared-contracts ESM SDK and its
golden fixtures. contracts/producer-pin.json fixes the reviewed producer commit/tree,
lockfile, schema/fixture manifest and machine-catalog bytes. It currently selects the
unreleased 0.6.0 candidate with 54 contract/version exports across 45 names. No copied
product validator or provider adapter is introduced.

Stage a platform-specific executable identity with:

```sh
integration-evals contract-runtime --node /approved/node --output node-runtime.json
```

Review that record before passing it to the runner:

```sh
integration-evals contracts --pin contracts/producer-pin.json --producer /pinned/shared-contracts \
  --runtime node-runtime.json --output reports/runs/contracts --candidate-scope
```

The runner verifies clean actual checkouts and binary bytes, denies network access,
contains subprocess lifetime, and invokes the producer's public `runCanonicalFixtures`
helper from the source target of its `./fixture-harness` export. The producer owns
fixture dispatch, byte-array contexts, expected canonical hashes and serialization
roundtrips. The consumer independently verifies schema hashes, every frozen case ID
and category, and complete harness accounting for successful and failed cases.
Schema and fixture joins use exact `(contract, version)` pairs. Fixture paths come
from the producer's fixture manifest and must agree with the catalog version entry;
the evaluator never infers a filename from a contract name. Every declared catalog
version remains required, including retained v1 exports when v2 is active.
Malformed manifests or missing canonical categories fail closed. Failures and complete
missing export names are retained in an immutable contracts.json receipt with a byte
hash. Raw payloads are withheld.

An explicit candidate-scope pass establishes only the implemented synthetic fixture
slice. Both scopes exit 0 for the complete pinned catalog; omitting candidate-scope
exits 2 when the producer's full catalog has missing exports. Every receipt keeps
product_acceptance blocked and owner acknowledgement null.
New receipts retain `required_versions` and each result's `fixture_path`. Missing
multi-version obligations are qualified, for example `BudgetReservation@2.0.0`;
single-version missing names remain unchanged. Original 0.5 receipts without those
fields remain readable and bind against their own single-version source checkpoint.
They cannot serve as unversioned coverage claims against a multi-version producer,
and their historical bytes are never rewritten or assigned new semantic labels.

The actual 0.6 harness's v1 finance semantic records retain
`historical_finance_characterization` and `operational_authority=false`. These labels
must exactly match the owner-declared legacy profile and executed semantic cases;
omission or invented current authority is rejected. Current operational helpers
reject that retired v1 semantic profile. V2 remains unaccepted source-only
representation checking, not permission, reservation, dispatch or ledger execution.
Package installation, owner agreement, real consumer domain handoffs and composed
release verification remain separate requirements. CI runs both scopes against exact
producer and Node pins; no provider credential or API budget is used.

The separate integration_tests scenarios require
IE_CONTRACT_SOURCE and IE_CONTRACT_RUNTIME pointing to that actual checkout and
runtime record. They verify complete candidate/full scope and make owned temporary copies
to contradict a golden verdict or canonical hash, invalidate a retained-encoding
category, or remove one schema-manifest export, repinning each controlled test revision.
Version-focused regressions additionally remove only finance v2, duplicate an exact
pair, cross schema/fixture paths, omit cases, and forge or remove historical labels.
The unchanged SDK must retain the precise golden failure or missing export with CLI
exits 1 and 2 respectively; invalid category coverage produces an error receipt.
They change no producer-owned source.
CI runs these tests under Linux isolation in addition to the default dependency-free
tooling suite.

## Current unresolved obligations

The [source retrieval component](retrieval-component.md) selects the original
Linux `ssrf-egress` case using a mock-only owner capability and pinned local fixture
hooks. Its finite transport/limit observations are partial IE-11A evidence; they do
not establish all DNS, egress or downstream handoff obligations.

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
