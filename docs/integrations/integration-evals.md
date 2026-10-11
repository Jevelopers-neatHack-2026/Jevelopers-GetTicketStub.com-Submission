# print-invalid producer command

This is the agreed **unaccepted development component slice** for original case
`print-invalid`, interface `production`, fault `print-invalid`, fixture
`asset-negative`, requirements `ART-04` and `IE-05D.AC1`. It supports only
`mock-only` with `synthetic` origin. Cost stays `null` / `unknown`.
`print-preflight` remains unsupported and blocked. No other selected case is
implicitly passed; this slice establishes no composed acceptance, real approval,
financial authority, purchase, supplier dispatch or production eligibility.

The protocol is pinned to integration-evals
`e0e1d28400a466fc45ace5962a9e54cb904d7036`, with timestamp clarification
`c0b7fd004028a03267dbbb90e08b4e2de9a00c0a`. The original IDs, assertion meanings,
payload bytes and catalog metadata are preserved in
`tests/fixtures/integration-evals/v1/`. The hostile text has **no trailing newline**:
SHA-256 `969bc670d1540ffce4823ea9ca7b9c9bd5154052c78a0460cf8c235f88cca4de`.
It remains quarantined text and is never rendered.

## Build and command arrays

Use the exact installed Node 24.21.0 and bundled npm 11.19.0, then run offline:

```sh
TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 npm ci --offline --no-audit --no-fund
TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 npm run build
TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 npm run typecheck
TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 node --test --test-concurrency=1 dist/tests/integration/production-owner-command.test.js
```

Put these arrays in the component manifest, executed without a shell in the exact
clean pinned print-production checkout:

```json
{
  "command": ["/approved/node-24.21.0/bin/node", "dist/scripts/integration-evals/cli.js", "run"],
  "cleanup_command": ["/approved/node-24.21.0/bin/node", "dist/scripts/integration-evals/cli.js", "cleanup"],
  "supported_modes": ["mock-only"]
}
```

The owner verifies actual Git HEAD against `component_revision`, requires clean
tracked sources, and reports actual HEAD/tree. Build generated code from that exact
checkout before evaluator use; independent review and evaluator checkout/lockfile
verification remain required. The producer report pins the final supplement source
commit/tree after committing rather than embedding a circular self-hash in a fixture.

The evaluator supplies the original serialized Case (including model defaults),
run ID, component revision, absolute configuration path, absolute staging path,
namespace, seed, timezone-aware clock and sanitized providers on stdin. Stdin is
limited to 64 KiB with a five-second input deadline; the invocation has a 25-second
deadline. The original two observations are returned in one OwnerResponse JSON
object on stdout. Invalid input, unsafe paths, unsupported cases/modes and runtime
failures exit nonzero with a fixed error code on stderr and no success response.

## Immutable configuration artifact

Create and review an immutable JSON configuration artifact in the declared
configuration component. Pin its actual byte digest in the evaluator assembly.
The request's `configuration_artifact` is its absolute canonical path.
The command validates the strict producer schema exported as
`tests/fixtures/integration-evals/v1/configuration.schema.json`:

```json
{
  "schema_version": "print-invalid-owner/v1",
  "case_id": "print-invalid",
  "fixture_id": "asset-negative",
  "supplement_id": "print-invalid-synthetic/v1",
  "payload_sha256": "969bc670d1540ffce4823ea9ca7b9c9bd5154052c78a0460cf8c235f88cca4de",
  "mode": "mock-only",
  "origin": "synthetic",
  "accepted": false,
  "node_sha256": "<actual SHA-256 of the approved Node executable>",
  "browser_root": "/ms-playwright",
  "renderer_image": "mcr.microsoft.com/playwright:v1.64.0-noble@sha256:bc72a8df40831ded821e3cbc79c318c21b44d6e51dff9fd89ace7a8249c5b462"
}
```

The placeholder Node digest must be replaced with actual measured bytes. The browser
root must be an existing approved canonical absolute directory containing the exact
pinned Playwright browser. macOS characterization uses its actual cache directory
and `renderer_image: null`. Linux uses the exact existing calibrated amd64 Noble
environment and image from `docs/runtime/pins.json`. A path or configuration
reference alone is never runtime authority: the unchanged candidate independently
checks Node/npm/OS/dependencies/browser bytes and Linux security observations.
Missing runtime bytes fail the invocation even before SVG validation.

The owner sets only its declared locale, timezone, approved browser lookup and
renderer image label from validated configuration. It uses no ambient credentials
and performs no network request or install. Sanitized provider records must remain
mock-only without eligibility, authority, cap or dispatch operations.

## Actual operation and evidence

The producer supplement uses the unchanged canonical fixture records/profile
builders and real pinned fonts/artwork. Its owned host maps the original hostile
bytes to the synthetic-logo overlay and recomputes the canonical asset/composition
hashes, input binding, layout commitment and request joins. Fictional approval
fixtures and permission callbacks are explicitly synthetic test data.

The public candidate `composeArtifact` resolves the real mapped runtime, records,
template, approval inputs and asset bytes, then invokes the existing private
composition/asset validation boundary. Its typed `PREFLIGHT_FAILED` /
`preflight` result supplies `typed_rejection`; asset resolution must have
actually occurred. `production_artifacts` is queried from actual namespace
SQLite publications. File, staged-file and blob counts before/after, actual attempt
and observation IDs, and the exact product result accompany the trace. Nothing
substitutes an unsupported-context failure for SVG validation.

Each requirement receives exact run/case/component/revision joins for:

- `trace.json`: typed product result, measured state, actual attempt/observation IDs.
- `mapping.json`: canonical request/records, private profile mapping, payload/config/source joins.
- `evaluation.json`: measured observations, trace/mapping hashes, Node executable
  receipt and the actual candidate's measured runtime mapping.

Evidence paths are relative to evaluator staging and hash actual bytes. IDs, kind,
permission, redaction and reviewer access satisfy the pinned OwnerResponse schema.
Mapping data is fictional and contains no executable permission callback, raw
private logs, hostile output or genuine approval/finance claims. Schema checks
alone are characterization; the evaluator must also verify joins, permission,
hashes and independently retain the evidence before cleanup.

Both `created_at` and `original_cutoff` use `request.clock` only under the
agreed synthetic logical-scenario convention. Every evidence item labels this
limit. Original fixture `collected_at=2026-10-10T00:00:00Z`, actual supplement
preparation provenance and wall-clock verification capture are retained separately.
This is no authentic live cutoff, financial approval or accepted consumer receipt.

## Namespace and cleanup

The evaluator's `HOME` and `TMPDIR` must identify the same canonical isolated
directory. Staging must be exactly `HOME/artifacts` and match
`IE_ARTIFACT_DIR`. Namespace must be `run_id-print-invalid` and match
`IE_NAMESPACE`; seed/clock/mode must agree with the evaluator environment.
Canonical absolute paths are required; traversal and every symlink path component
are rejected, including host filesystem aliases. The isolated root cannot be the
checkout, its parent, its descendant or filesystem root.

The command exclusively claims `artifacts/pp-<namespace>`, writes a request-bound
ownership marker and stores its SQLite/evidence files there. A repeated invocation
cannot overwrite retained files. Cleanup receives the same request/environment and
does not require the operation's revision/configuration check to have succeeded.
It validates ownership and every entry before removing the finite allowlist, removes
the ownership marker last, and preserves staging and unrelated paths. Absent owned
namespace is an idempotent successful no-op.

Interrupted execution after a complete marker can be cleaned. An empty or corrupt
partial marker, unexpected file, mismatched request or symlink makes cleanup fail
honestly and preserve uncertain files. The evaluator finally path records that
failure/uncertainty; it must not report a passing case. Cleanup never recursively
removes the staging/root directory. The evaluator separately bounds cleanup to at
most 30 seconds; the owner adds its own 25-second deadline.

## Verification limits

The focused tests drive actual subprocess stdin/stdout and validate the response
against the pinned JSON schema, evidence bytes/hashes and real publication state.
A separate safe-counterpart subprocess uses the same host and real public compose
operation, succeeds and hashes actual published product files. It is a positive
control for the rejection boundary, not support for `print-preflight`.
Negative tests cover context/config/revision, cases/modes, bounded malformed input,
traversal/symlinks, failed runtime, repeated invocation, uncertain partial ownership
and actual process interruption.

macOS producer subprocess execution is local characterization only: integration-evals
prohibits child process creation under its macOS sandbox. Required Linux evaluator
execution must use its network/PID isolation plus the unchanged producer calibration
and security policy. No compatible Linux environment was established by this source
implementation. No VM, containment exception or CI repair was introduced.
Parent independent Astra High review, fresh source integration, Linux evaluator run,
consumer acknowledgement and all broader repository acceptance remain outstanding.
