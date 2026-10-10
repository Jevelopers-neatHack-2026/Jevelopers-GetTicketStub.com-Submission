# DUR-R4 dispatcher ownership checkpoint

The original finding remains open at the dispatcher boundary until its owner
wires the private helper. The original dispatcher inherits Node test worker
context and can record a private success without running tests. This change does
not grant canonical, application, finance, consumer, Linux or release acceptance.

The helper in `src/internal/independent-tests.ts` exposes:

- `runIndependentTests`: explicitly selects TAP output, removes inherited
  `NODE_TEST_*` environment variables, requires nonzero executed and passing test
  counts with zero failures, skips, cancellation or todo cases, and checks fresh
  artifacts against a random execution nonce.
- `durabilityTestFiles`: each private named suite's unit regressions and real
  process tests, relative to `dist/tests`.
- `durabilityProcessEvidence`: required process artifacts, including concurrent
  claims/publication, killed transactions, uncertain publication, denial,
  cancellation with a full outbox and abandoned-byte cleanup.

The dispatcher owner should replace the external-blocked leaf's direct
`execFile` runner with `runIndependentTests`. Resolve `durabilityTestFiles[suite]`
relative to the existing compiled tests directory. Pass the suite's `local`
evidence directory and `durabilityProcessEvidence`. The helper returns the
command, actual test/pass counts, fresh execution directory/nonce and stdout/
stderr digests only after all checks succeed. Record those fields in the private
receipt. Propagate helper failure as `RUNTIME_FAILURE`, remove or invalidate a
pre-existing local success receipt before starting, and retain the nonzero
`external-blocked` result after private success.

Strengthen `tests/unit/durability-dispatcher.test.ts` at handoff to verify fresh
SIGKILL artifacts and positive execution counts for all three suites from nested
`node --test`. Exercise a deliberately failing child canary at the dispatcher
boundary and require `RUNTIME_FAILURE` without a fresh private success receipt.
The helper already has passing/failing canary coverage from normal CLI and nested
test execution, and runs each named suite from nested tests. Dispatcher source
and its existing receipt-only tests have not been changed under this ownership
checkpoint.

Independent report history is retained in `durability-review-result.json`:
DUR-R1 through DUR-R6 were independently reproduced against `39951f6`. Fresh
Astra review of the revised exact candidate is required; the implementation
worker has not supplied that review. ROOT-R1 and revised Linux startup remain
independent parent blockers.
