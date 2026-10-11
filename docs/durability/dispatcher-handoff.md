# DUR-R4 dispatcher handoff

The supervisor handed dispatcher ownership to the durability writer after the
composition writer stopped cleanly at `cce8b116`. The checkpoint at `0471baf`
left this boundary open. Dispatcher wiring is now implemented and regression
verified in the durability branch. The original finding and checkpoint report
remain historical evidence; fresh independent review is still required. This
does not grant canonical, application, finance, consumer, Linux or release
acceptance.

The helper in `src/internal/independent-tests.ts` exposes:

- `runIndependentTests`: explicitly selects TAP output, removes inherited
  `NODE_TEST_*` environment variables, requires expected executed and passing test
  counts with zero failures, skips, cancellation or todo cases, and checks fresh
  artifacts against a random execution nonce.
- `durabilityTestFiles`: each private named suite's unit regressions and real
  process tests, relative to `dist/tests`.
- `durabilityProcessEvidence`: required process artifacts, including concurrent
  claims/publication, killed transactions, uncertain publication, denial,
  cancellation with a full outbox and abandoned-byte cleanup.
- `durabilityExpectedTests`: exact current manifest counts (45/68/36). The
  dispatcher adds the independent canary to each manifest and requires 46/69/37.
  An intentional test addition must update the corresponding expected count.

The durability dispatcher now uses those manifests, exact counts and the
required canary/process artifacts. The helper returns actual test/pass counts,
artifact digests, a fresh execution directory/nonce and stdout/stderr digests
only after all checks succeed. The dispatcher removes a previous local receipt
before execution, writes a failed private receipt on error, propagates
`RUNTIME_FAILURE`, and retains a nonzero `external-blocked` outer result even
after private success.

Dispatcher regression tests now verify real counts and artifacts from both
normal CLI and nested `node --test`, plus deliberately failing canaries in both
contexts. The failure fixtures require actual canary execution and reject a
fresh passing receipt. Helper tests also reject a passing child with an
unexpected test count or missing artifacts.

For the later composition integration, `runIndependentTests` accepts an explicit
`evidenceEnvironment` with `directoryVariable` and optional `nonceVariable`.
`requiredEvidence` may contain paths with Zod schemas for composition's existing
artifact format, which has no durability nonce. Those files must exist and
validate in the freshly created execution directory; their digests are returned
with the run's nonce. Strings retain mandatory nonce checking for durability.
Supply measured exact `expectedTests` for each of the six composition manifests,
set the directory variable to `PP_COMPOSITION_EVIDENCE_DIR`, and validate required
render/content artifacts. A composition-shaped fixture tests this reusable
configuration. The composition branch and its core modules have not been edited
or integrated here; the parent owns that later dispatcher merge and its checks.

Independent report history is retained in `durability-review-result.json`:
DUR-R1 through DUR-R6 were independently reproduced against `39951f6`. Fresh
Astra review of the revised exact candidate is required; the implementation
worker has not supplied that review. ROOT-R1 and revised Linux startup remain
independent parent blockers.
