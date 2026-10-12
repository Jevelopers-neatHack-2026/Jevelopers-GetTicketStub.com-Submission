# Finance public component DEVELOPMENT

This additive lane exercises the exact cost-intelligence development handoff
`4f3ae9e5cf31f5bce295582db7c76f78cccb93f2` (tree
`091e66027ff1cb4664c8ff53dd8450c34781e973`). It uses the producer's actual
exported package functions and real PostgreSQL 16. All authority, source,
lease and access decisions are explicitly synthetic owner fixtures. Matching
query digests and scope labels do not establish genuine authority.

The global goal remains 42 cases, 142 obligations and 47 criteria: 3 verified,
44 planned. This lane does not complete IE11, IE13, BUD, FIN, installer/security
acceptance, host composition or provider dispatch. The existing default
contract and other workflows are unchanged. Shared contracts 0.3.0 at
24eae28 remain proposal_only with adoption_accepted=false. All synthetic money
uses exact decimal strings with at most nine fractional digits; no consumer
precision claim is added. Later upstream hardening is not silently repinned.

## Execution and custody

Run on the existing authorized GitHub Linux runner using
`.github/workflows/finance-component.yml`. It pins Node 22.23.3, npm 10.9.9,
TypeScript 5.9.3 and the PostgreSQL manifest digest from
`contracts/finance-producer-pin.json`. The driver rejects other platforms,
external database environment variables, dirty/drifted producer sources,
changed archives, changed dependencies and changed migration bytes.

```sh
node finance_component_tests/run.mjs /absolute/exact-clean-producer /absolute/new-output
```

The output directory must not already exist. Use a disposable source checkout;
`npm ci --ignore-scripts`, typecheck and build execute there. The driver supplies
an isolated HOME and npm cache and passes only explicit environment variables
to children. The workflow uploads sanitized receipts for 30 days, including
failures. HOME/cache contents and generated credentials are excluded.
Diagnostic string values are sanitized before JSON serialization; the owner's
text sanitizer is not applied to serialized JSON delimiters. Evaluator custody
records actual file hashes and requires a clean working tree before execution.

The producer's unchanged `scripts/with-postgres.mjs` accepts fixed named suites
only, with no external-test callback. The evaluation-owned `container.mjs` and
`database.mjs` therefore implement just its disposable fixture protocol. They
reuse the owner marker validator, sanitizer, test-file evidence parser and
reservation harness; apply all ten actual hash-checked migrations; and create
separate restricted runtime and migrator logins with the same grants. They
contain no ledger, authorization or monetary implementation. No producer file
is patched or replaced.

Containers use a unique nonce label, captured full ID, exact image and loopback
ephemeral port. Only that owned container is removed. Startup, child tests and
Docker operations have timeouts. The role privilege rows, applied migration
rows, PostgreSQL version, marker, container identity and confirmed cleanup are
retained. Failure or uncertain cleanup prevents a passing receipt. The identity
file is written before startup so an interrupted run retains recovery context.

## Scenarios and binary oracles

| Scenario | Actual invocation | Binary observable | Output artifacts |
| --- | --- | --- | --- |
| Policy/admission/current authority | Public `changeBudget`, `authorize`, `getReservationSnapshot`, `revalidateAuthorization` | Limit1 and held0.75; advisory snapshot cannot dispatch; preparation authorized; historical replay omits finance; changed target/revoked proof denied; SQL exactly one retained hold, zero money rows | admission.json; admission.test.mjs.result.json |
| Unknown intake and isolation | Public `ingestUsage` twice then unrelated `authorize`, plus foreign trusted scope | accepted/durable/awaiting_evidence then duplicate; unavailable/no finance; zero holds and zero money rows; foreign admission cannot cover original scope | unknown-intake.json; scope-isolation.json; intake.test.mjs.result.json |
| Covered unknown exposure | Public `authorize`, exact-attempt `ingestUsage`, admission replay and another0.25 admission | one0.75 hold before second admission; replay has no fresh finance; final two holds totaling1, zero money rows, available0 | covered-intake.json; intake.test.mjs.result.json |
| Durable recovery | Public `ingestUsage` and `replayUsageOutbox` | pre-insert fault yields durable retry; replay posts exactly one0.000003 USD ledger row; another replay scans/posts0 | recovery.json; recovery.test.mjs.result.json |
| Lifecycle boundary | Public `settle` and `release` | both BUDGET_UNAVAILABLE; original0.75 hold retained; no monetary row | lifecycle-unavailable.json; admission.test.mjs.result.json |
| Runtime and fixture | Driver plus actual PG role/migration queries | pinned runtime/source; PostgreSQL16; restricted logins; all ten migrations; successful role/container cleanup | receipt.json; source-custody.json; producer-source.tar; container-identity.json; postgres.log |
| Build/dependencies/artifacts | Exact npm install/typecheck/build and SHA256 manifests | successful commands, actual installed/build byte manifests, artifact hashes | build-0.json through build-3.json; build-manifest.json; dependency-manifest.json; artifacts.json |

Each case trace retains its public input/output and independent observer SQL
results. Expected counts and exact strings are assertions in evaluator tests;
the submitted result does not supply its own expected answer. Source custody is
verified before and after execution. The owner structured test reporter rejects
empty/skipped/todo/cancelled/failed files; the evaluator receipt validator also
requires the exact file set and five executed cases (six traces, including the
separate foreign scope).

Recovery deliberately follows owner `tests/recovery/recovery.test.mjs:635`:
one controlled error before an actual ledger insert, then a scoped fixture-only
`available_at` adjustment. All durable intake and posting are actual public API
operations. This is outbox recovery, not unknown reservation-outcome recovery.
Optional partial acknowledgement and public dispatch are outside this lane.
Low-level `settleReservation` and `releaseReservation` are never substitutes.

## Validation limits

The receipt unit fixtures are labelled synthetic validator inputs and cannot
serve as PostgreSQL acceptance evidence. Run them with the pinned Node binary:

```sh
FINANCE_SOURCE=/absolute/exact-producer node --test \
  finance_component_tests/receipt.test.mjs \
  finance_component_tests/sanitization.test.mjs
```

A successful local syntax, source, build or unit check is not a PostgreSQL pass.
The first independent component execution requires fresh Linux CI artifacts
and parent QA/review. The previous owner's 161 hosted summaries had no uploaded
manifests; the retrieved raw log hash differed from the owner's quoted hash.
That custody gap is preserved and none of those logs is borrowed as this
consumer's execution proof.

## Finance924 captured-fixture consumer mode

The additive `--candidate-924-fixtures` mode consumes the exact owner-accepted
synthetic pagination capture from producer `924cdd2b5489681434790b5d1d7aac138198ccfd`
(tree `88c0bcaeaaee050678ca59261229c5f9ad1bfd13`), candidate run `38248332764`.
`contracts/finance924-fixture-pin.json` admits the exact committed capture bytes,
trusted schemas and independent definition registry. It preserves the original
payload's synthetic source placeholder and its historical baseRevision; these
fields are not substituted with the accepted producer head.

```sh
node --test finance_component_tests/candidate924.test.mjs
node finance_component_tests/run.mjs --candidate-924-fixtures /absolute/new-output
```

Use Node22.23.3 and a clean evaluator checkout. This mode requires no producer
checkout, npm, build, database, grant, provider or account connection. Execute
under OS network denial with task-scoped artifact writes for local qualification.
It records consumer revision/tree, exact fixture hashes and ten executed
assertion groups in a separate `synthetic-captured-fixture-consumer` receipt.

The three pages retain six unique ordered detail IDs, frozen query/summary/
reference hashes, snapshot identity, aggregate and watermark. Continuation sends
the prior opaque nextCursor unchanged; the third page is terminal. Money remains
exact decimal strings, including `1.000000000000000001` USD direct costs, and
per-currency detail sums use BigInt scale18 arithmetic without FX inference.
All nine typed refusals retain their expected error codes. Captured read counters
are not used to claim zero SQL reads, particularly for revocation after COMMIT.

The trusted FinancialSummaryPageSchema is explicitly a partial wrapper.
Validation therefore also resolves the pinned proposal-only FinancialSummary
schema and its offline CommonEnvelope/ErrorEnvelope dependencies, checks scope,
unknown coverage, registry policy/metric references and content hashes, and
recomputes summary/query/record/reference hashes. The bounded schema interpreter
rejects unsupported validation vocabulary and unpinned external references.
This is evaluation-owned combined fixture validation; no producer query or
canonical SDK business operation is represented as having executed.

The partial simulated subtotal `5`, null total and one unknown amount are a
separate unchanged Finance22 fixture. Its receipt keeps source `22a3237`; the
Finance924 pagination capture itself contains six recognized details. The page
schema and registry retain their Finance22 heritage and were verified byte-identical
against producer924 Git blobs. No historical22 fixture is relabelled as924.

Any consumer ACK is `SCOPED_SYNTHETIC_FIXTURE_CONFORMANCE_ONLY`, bound to the
immutable consumer commit and exact capture hashes. It cannot establish current
grants, live billing, producer execution, PostgreSQL acceptance, export adoption,
selected release or a full verification run. The existing4f3 producer pin, default
finance workflow and old PR50 evidence remain unchanged.
