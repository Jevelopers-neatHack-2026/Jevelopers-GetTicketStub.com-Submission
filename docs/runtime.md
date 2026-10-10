# FC-01 runtime foundation

This branch provides a typed, injected worker-runtime foundation. It does not include a production provider adapter or persistence implementation, canonical upstream schemas, an issuer or finance integration, sandbox credentials, or a live mode. Compatibility with the application worker has not been verified: the repository began as documentation only, and no consumer package or accepted runtime pin was available to test against.

## Runtime and commands

The package pins Node `24.15.0` in `.node-version` and `engines`, npm `11.12.1` in `packageManager`, and TypeScript `6.0.3` in the lockfile. TypeScript is a development dependency; the package has no runtime dependencies. The tests use private fixture bindings and a fake transport and do not call a provider or another repository.

From a clean checkout:

```sh
npm ci
npm run build
npm test
./scripts/verify-fulfillment --suite contract --mode simulated --evidence-dir evidence/FC-01
```

`npm test` builds the TypeScript package and runs the local contract fixture suite without network access. `npm ci` installs from the lockfile and may need access to the npm registry unless the locked packages are already cached. The verifier writes `result.json` in the requested evidence directory and emits the same machine-readable result on stdout. A local contract result passes only the `local_private_fixture_contract_suite`; it keeps missing accepted pins and producer/consumer conformance in its blocker list. Missing arguments, unknown suites, a missing build, a wrong Node version, failed checks, and evidence write failures return nonzero with a JSON failure result when stdout remains available.

`--suite sandbox --mode sandbox` and `--suite release` return failure until the selected sandbox adapter, accepted schema/fixture pins, and conformance evidence exist. The CI workflow runs Node setup, locked install, build, local tests, and only the simulated fixture contract command. It is triggered by `push` and `pull_request`, grants only `contents: read`, pins the checkout and Node setup actions to immutable commit SHAs, and does not use secrets, deploy, publish, upload artifacts, purchase anything, or contact a provider.

## Runtime boundary

`FulfillmentConnectorRuntime` receives a provider adapter plus injected contract validation, transport, clock, attempt persistence, authorization verification, budget authorization, and usage recording. It has only `simulated` and `sandbox` modes; simulated is the default, sandbox is disabled unless explicitly enabled and accepted contract pins are ready, and `liveModeSupported` is always false. The package creates no provider client or endpoint. The caller owns the behavior of its injected ports.

The typed adapter surface covers capability discovery, quote, pre-submit validation, order submit, status, shipment/tracking observation, and cancellation. Provider declarations identify API version, product limits, supported modes and operations, side-effect behavior, charge potential, and idempotency semantics. Unsupported operations fail as typed errors. Submit validates quote identity, expiry, artifact digest, terms binding, exact currency and amount, then passes an immutable provider/environment/scope/action snapshot to an injected `verifyAndClaim` port. That port must verify the actual facts with the external issuer and atomically claim the permitted action; a caller-supplied request fingerprint or local boolean check cannot authorize dispatch. A durable persistence implementation must atomically reject a second claim by the same issuer authorization or action identity, independent of provider idempotency keys, and retain the claim across workers and restarts.

Before budget authorization, the attempt durably enters `pending`. A confirmed reservation state and any returned reference are persisted before provider dispatch; a timeout or malformed response is retained as `unknown`, and the earlier durable `pending` state still blocks replay if saving that update fails. Reservations are never reset by provider non-dispatch. This foundation has no budget reconciliation or release port, so `pending`, `reserved` after provider non-dispatch, and `unknown` reservations remain blocked. No reconciliation path is implemented here; a future authorized integration must resolve them with the external budget authority. A persistence implementation must not reclaim a claimed action. Connector-owned cancellation attempts and chargeable cancellations fail as typed `unsupported` until cancellation persistence and reservation reconciliation are available.

These are private adapter-facing port requirements only. The repository contains neither an accepted issuer/action-claim protocol nor a finance reservation/reconciliation integration. Fixture ports exercise the fail-closed behavior but do not establish external issuer or finance conformance.

Amounts use positive safe-integer minor units for submit and budget reservations. The adapter must preserve exact values and must not turn an unknown cost into zero. The accepted currency schema must define each currency's minor-unit exponent and rounding rules; those rules are not inferred by this foundation. Quote normalization validates that explicit integer breakdown lines sum exactly to the explicit quote total and that the quote has not expired. Full quote breakdown, expiry, tax, shipping, and currency normalization remain part of FC-09 and require accepted contract terms.

Public connector errors carry module, operation, typed code, a fixed safe message, diagnostic reference, retryability, and side-effect state (`not_dispatched`, `possible`, `confirmed`, or `unknown`). Raw provider exceptions and sensitive strings are not included. Retryability describes transport recovery only; it does not authorize another attempt or budget reservation.

## Cross-repository payload ownership

The following are ownership references, not locally defined schemas or accepted pins. Each runtime boundary requires an injected `ContractValidator`; upstream schema versions, source revisions, fixture digests, and external consumer conformance are currently missing. Development fixtures are private to this repository and cannot make sandbox or release readiness true.

| Payload or shape | Schema / authority owner | Connector responsibility |
| --- | --- | --- |
| Operation envelope, capability, print specification, preflight report, operation result | [shared-contracts #4](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/4); coordinate print-specification production with [print-production #5](https://github.com/Jevelopers-neatHack-2026/print-production/issues/5) | Validate inbound requests and publish typed results through accepted versioned contracts |
| ProductionBundle | [shared-contracts #24](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/24); approved artifact authority remains external | Consume the immutable approved bundle and pinned schema/fixtures |
| FulfillmentQuote | [shared-contracts #25](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/25) | Normalize provider quotes only after terms and currency rules are accepted |
| OrderAuthorization and allowed-action claim | [shared-contracts #26](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/26); issuer and atomic claim authority are external to this repository | Consume exact immutable action facts and an issuer-owned atomic claim; never issue or broaden authorization |
| Shipment/status observation | [shared-contracts #27](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/27) | Produce validated status and shipment observations |
| Fulfillment usage intake and report | [shared-contracts #11](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/11); intake is owned by `cost-intelligence` | Report provider operation outcome and side-effect state through the accepted intake contract |
| Budget reservation request, decision, reference, and disposition | [shared-contracts #12](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12); budget authority is `cost-intelligence` | Send a contract-validated reservation before provider dispatch, retain uncertainty, and wait for the external authority to resolve it; do not define another budget authority |
| Provider SDK types, private adapter models, transport payloads | `fulfillment-connectors` | Own and keep private to this repository |

No local schema is a substitute for shared-contracts. Before claiming cross-repository conformance, record the accepted contract issue, exact schema version, owner repository revision, fixture revision and digest, and matching producer and consumer test results. The requests for upstream definitions do not establish acceptance.

## FC-01 criterion audit

| Criterion | Local evidence in this candidate | Still required before closure |
| --- | --- | --- |
| FC-01.1 — typed provider operations and declared capabilities | The adapter API and local fixtures exercise capability discovery, quote, pre-submit validation, submit, status, shipment observation, and cancellation, with provider/mode/API/product/side-effect/idempotency declarations. Unsupported cancellation is a typed failure. | Select and validate a real provider adapter; verify the application consumer and accepted shared operation/result schemas. |
| FC-01.2 — safe typed failures and side-effect reporting | `ConnectorError` exposes the required fields, maps stale quote/auth, rate limit, timeout, ambiguous submit, reservation uncertainty, and unsupported cases, and omits raw provider details. Tests cover uncertain outcomes and ensure retryability grants no extra budget authority. | Record producer/consumer error-shape conformance against accepted contracts and review provider and finance reconciliation behavior. |
| FC-01.3 — boundary validation and executable evidence | Injected validation checks tenant/project receipts and schema majors before transport; the private fixture checks additive same-major input. Simulated mode is default, no live mode is exposed, and the named wrapper emits JSON evidence and fails unavailable suites. | Run the accepted version/compatibility fixtures in both owning producer and application consumer repositories, and provide an authorized sandbox adapter and evidence. |
| FC-01.4 — cross-repository payload ownership | The table above names the schema and authority owner for every cross-repository payload, including budget reservation and usage intake. | Accept and pin each upstream schema, source revision, fixture digest, and matching producer/consumer result. |

These local checks establish foundation behavior only. Every external conformance item in the right-hand column remains open; a passing simulated fixture run is not full FC-01 acceptance.

## Current evidence and remaining gates

The local fixture suite covers all seven typed operations, injected ports, tenant/project mismatch rejection, unsupported schema majors, additive same-major input through the validator, missing pins, stale quote and authorization, exact immutable authorization facts, caller mutation while ports await, budget denial and uncertain reservation restart behavior, rejected connector-owned cancellation persistence, ambiguous submission across new keys and process restarts, safe error mapping, same- and distinct-key concurrent action claims, no spending authority from retryability, invalid JavaScript modes, sandbox rejection, and safe-integer amount validation. Restart tests reuse an in-memory fixture map to verify runtime behavior; they do not prove a production persistence implementation survives process failure.

This evidence is useful for the local runtime boundary only. FC-01 remains partial until upstream payload definitions and pins are accepted, consumer compatibility is tested in the application and producer repositories, and a selected sandbox adapter is exercised with authorized test credentials. No sandbox or live provider calls have been made. Related quote details and currency rules remain in FC-09; downstream release checks must not treat a passing private fixture suite as full FC-01 acceptance. FC-02's documented Prodigi candidate, unavailable selection/account evidence, and offline-first matrix policy are recorded separately in [docs/provider-matrix.md](provider-matrix.md); those local checks do not make sandbox ready.
