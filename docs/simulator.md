# Deterministic offline simulator

`src/simulator.ts` provides a provider-shaped local fixture for runtime development and repeatable failure tests. It supports only `simulated` mode. It has no supplier endpoint, network client, credential input, or environment-variable lookup. Its transport accepts a small set of fixed local route strings and mutates an in-memory state object that can be saved as JSON and restored after a restart.

The simulator is not a selected supplier adapter, sandbox receipt, authorization issuer, production-bundle validator, or finance ledger. Its private fixtures use `development_fixture` bindings with an explicit synthetic digest. `runtime.audit()` therefore continues to report missing accepted contract pins, `sandboxReady: false`, and `liveModeSupported: false`. Nothing produced by this module counts as upstream contract acceptance, sandbox evidence, a real budget reservation, a purchase, revenue, or a charge.

## Run the local suite

With the pinned Node 24.15.0 and npm 11.12.1 toolchain and locked dependencies installed:

```sh
npm run build
node tests/mock-suite.mjs
```

The suite uses the existing runtime with synthetic development-only contract, authorization, budget, persistence, and usage ports. It does not change the canonical schema catalog or claim those private ports are accepted production integrations. The fixture state and provider state are JSON serializable; the restart cases copy them through JSON before creating a new runtime and simulator instance.

The suite guards `globalThis.fetch`, checks the simulator source for HTTP, DNS, socket, TLS, `fetch`, and environment access, and verifies that no fetch call occurs. It was also run on macOS under `sandbox-exec` with the `network*` rule denied and an empty environment, which provides OS-level network denial for that run:

```sh
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  /usr/bin/env -i PATH=/opt/homebrew/bin:/usr/bin:/bin \
  /opt/homebrew/bin/node tests/mock-suite.mjs
```

The executable paths may need adjustment on another host. The suite starts with no credentials and the simulator accepts only a synthetic seed and fixed start time.

## Determinism and synthetic quote terms

Create a new simulator with a non-secret test seed and a fixed ISO timestamp, or restore a snapshot returned by `snapshot()`:

```js
const simulator = createDeterministicSimulator({
  seed: "fixture-seed-v1",
  startAt: "2026-10-10T14:00:00.000Z"
});
const saved = JSON.parse(JSON.stringify(simulator.snapshot()));
const restarted = createDeterministicSimulator({ snapshot: saved });
```

The clock is synthetic and advances only through `advanceTime()`. Synthetic quote and order identities derive from the seed and normalized fixture terms. The quote uses a fixed local price table: 1,200 USD minor units per item, 300 minor units shipping, and a simulated 10% tax on production, rounded to the nearest minor unit. Those figures only make deterministic tests possible; they do not describe any provider price, tax obligation, shipping charge, or quote policy.

The simulator hashes the production bundle and print-specification inputs for comparison, but does not store their original contents. It omits the destination and authorization envelope from provider requests and simulator state. Submit requests carry only local quote terms, the bundle digest, amount/currency, an opaque request fingerprint and the provider idempotency key. The test verifies a synthetic address is absent from provider snapshots and usage events. Do not use real customer material in fixtures.

Quote terms expire according to the stored synthetic clock. The default quote lifetime is one hour. Provider idempotency records have a local 30-day lifetime by default; tests can set shorter intervals and advance the clock. Reusing a live key with the same normalized request returns its original synthetic order. Reusing it with different terms fails with a provider-style conflict. After the simulator's configured key expiry, the fixture permits a new synthetic order generation. This is a deliberate local fault model, not a statement about a real supplier's retention policy.

Accepted simulator orders append an evidence record with `billingMode: "simulated"` and `charged: false`. Runtime budget and usage ports in `tests/mock-fixtures.mjs` are also synthetic and stay in serialized test state. A reserved or uncertain test record does not authorize, reserve, or charge real funds.

## Operations and fault controls

The runtime exercises capability discovery, quote, preflight, submit, status, shipment observation, and cancellation. Quote, preflight, status, shipment, submit, and cancel dispatch only to the simulator's local transport. `validateBeforeSubmit` checks the local quote record and does not dispatch. Capability discovery reports the adapter descriptor without a transport call.

Pass one-shot faults to a new simulator. Faults are part of the serializable state and are removed when triggered.

| Fault | Behavior | Expected evidence |
| --- | --- | --- |
| `refuse_before_dispatch` | Adapter rejects before its transport call | Provider dispatch count remains zero; submit remains `not_dispatched` |
| `unsupported` | Adapter reports an unsupported result before transport | Runtime returns `unsupported`; dispatch count remains zero |
| `rate_limit` | Local transport returns a 429-shaped failure before changing provider state | One dispatch, no new order; submit remains conservatively `possible` in the runtime |
| `accepted_then_timeout` | Simulator persists one accepted order and then loses the response | One order and one dispatch; runtime preserves an ambiguous attempt and blocks retry |
| `crash_after_acceptance` | Simulator exposes a crash barrier after persisting the order and before returning the response | Test captures provider plus runtime durable snapshots at that boundary, then restarts from them; the attempt is still `unknown`, status lookup can reconcile it, and a new key cannot dispatch again |
| `malformed_response` | Simulator performs the operation and supplies an invalid response shape | Submit stays ambiguous if an order was accepted; malformed output is not treated as success |
| `unknown_status` | Status lookup returns an explicit unknown observation | Unknown remains unknown; it is not promoted to accepted or completed |

The crash test models the durable boundary with an in-process snapshot callback rather than killing the operating system process. It resumes from the captured snapshot taken before runtime error handling can update the attempt. This verifies restart behavior at the relevant persistence boundary without claiming process-kill testing.

Callbacks can be queued with an optional delivery delay and delivered in any order. Re-delivery of one event ID is deduplicated. Status rank never moves backward when an older status arrives after a newer one, and delivered remains terminal against a later cancellation observation. Shipment callbacks are additive and deduplicated by synthetic shipment identity, so a split order retains each package exactly once. The current runtime `ShipmentResult` is singular; `simulator.shipments(providerRequestId)` exposes all local split-shipment records for tests.

## Scope limits

The private preflight fixture only checks that the local inputs can be hashed as JSON. It does not verify rights, dimensions, file formats, accepted production specifications, or unchanged approved bytes. Use the separately owned offline validator for those checks. The local simulator also does not authenticate real callbacks, contact a provider for reconciliation, publish finance observations, create authorizations, or make a sandbox call. Those gates remain pending until their owning contracts and implementations are verified.
