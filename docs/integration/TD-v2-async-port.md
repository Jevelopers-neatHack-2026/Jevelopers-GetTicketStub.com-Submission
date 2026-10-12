# TD v2 async read port (SYNTHETIC_PROPOSAL)

Private, offline slice on top of the PR29 Finance v2 views (`docs/integration/TD-v2-fixture-views.md`). Still **not owner-accepted**: the Finance v2 proposal is frozen WIP (`WIP_PROPOSAL_NOT_ACCEPTED`, source base `a08760e9`), the API is unmerged, and no Finance or Dashboard owner has acknowledged any of this. This document describes a **claim of the dashboard's own seam**, not a new grant, not a Finance contract and not an integration.

## What exists

`src/views/finance-v2/`

- `async-port.ts`: port types, `classifyFinanceV2Fault`, `resolveFinanceV2Port`, and the `useFinanceV2Read` lifecycle hook.
- `FinanceV2ConnectedView.tsx`: `FinanceV2ConnectedView`, the hook plus `FinanceV2View`.
- `check.ts`: `checkFinanceV2Page` now also takes the expected query and summary hashes (`QUERY_HASH_MISMATCH`, `SUMMARY_HASH_MISMATCH`).
- Fixture host: `integration/fixture-host/finance-v2-port.ts` (a scripted SYNTHETIC_PROPOSAL port over the existing fixtures) and `main.tsx` (injects it).

The frozen PR29 wire types (`FinanceV2Page` and friends) are unchanged. The only additions to `types.ts` are the two refusal codes above.

## The port

```ts
read(request: {
  scope: OpaqueProductScope;                 // host-stated, trusted, independent of the response
  expectedSnapshotId; expectedQueryContentHash; expectedSummaryContentHash;
  authorization: { token; revision };        // from the host seam, never the URL
  signal: AbortSignal;
}): Promise<FinanceV2Input>                  // ready page | missing | restricted | unauthorized | unknown
```

- **Host-injected and read-only.** The dashboard has no default port, no fake Finance implementation and no grant alias. A port declares `kind: 'SYNTHETIC_PROPOSAL'`.
- **Authorization seam**: `authorization = { revision, token(signal) }`. The token is requested fresh for every read, handed to the port, and never rendered, logged or placed in a URL. A `null` token means no read is attempted and the state is `unauthorized`.
- **Host gate**: `availability = { status: 'available' } | { status: 'refused', reason }` is explicit and required. `refused` never calls the port. The dashboard does not compute it from a grant, and **the current host Finance grant map is UNSUPPORTED**: nothing here maps, aliases or approves a Finance grant, and no owner approval is implied.
- **Identity**: the response must match the requested scope (all five fields), snapshot id, query hash and summary hash by string equality (`checkFinanceV2Page`). The browser does not compute or verify hashes, is not an authoritative artifact and does no money math.
- **Pagination is unsupported.** The frozen handoff states that the snapshot reader returns the authoritative first page only, and that a continuation page is not byte-identical and is rejected. v2 continuation is unaccepted, so the request carries no cursor (`FINANCE_V2_PAGINATION = 'unsupported'`) and `hasMore` / `nextCursor` are shown as delivered with "no further page is fetched". No query is invented.

## Lifecycle and state accuracy

`loading` -> one of `ready`, `refused` (identity or shape), `missing`, `restricted`, `unauthorized`, `unknown`, `error` (retryable or not), `unavailable` (no usable port) or `gated` (host refusal). Only `ready` renders amounts; the rest are fixed text with no amount.

- The result is valid only for the identity it was produced for. Whenever **scope (tenant, project, environment, billing mode, actor), authorization revision, expected snapshot, query hash or summary hash** changes, the previous result is not shown even for one render (the hook returns `loading` synchronously), the in-flight read is aborted, and its answer is dropped.
- **Ignored abort**: a port that ignores `signal` and answers late is dropped by a per-attempt liveness flag plus the identity key, so a late response cannot render. The same holds after unmount, after a timeout (default 15 s, `timeoutMs`), after a retry supersedes an attempt, and after the host withdraws availability or the token.
- **Typed faults** (from numeric `status` / `code` only; messages, bodies and headers are never read or shown):

| fault | state | retry |
|---|---|---|
| 401 | unauthorized | no |
| 403 | restricted | no |
| 404 | missing | no |
| 429 | error `rate_limited` | yes |
| 5xx | error `server` | yes |
| timeout (`code: 'TIMEOUT'`, `TimeoutError` or hook timeout) | error `timeout` | yes |
| anything else | error `failed` | no |

## Integrated mode

`mode: 'INTEGRATED'` is typed `port?: undefined`: no accepted Finance port type exists, so there is nothing to inject. At runtime it always resolves to `unavailable` and never reaches a port or fixture, even if a synthetic port is smuggled in. The hook and view import no fixture module; fixtures reach the page only through a port a host chose to inject in SYNTHETIC_PROPOSAL mode. A future accepted port needs a new, owner-accepted type; this slice does not invent one.

## CFO export

Unchanged: every view shows a restricted notice and a disabled "Export unavailable" button. There is no export port, no file, no `download` link and no success state, before or after hydration. It stays disabled until an export port is accepted by its owners.

## Fixture host

`?state=ready&v2=<fixture>` now goes through the injected port. Fixture-host-only knobs: `v2port=ok|tagged|slow|fault401|fault403|fault429|fault500|timeout|hang|flaky|none`, `v2timeout=<ms>`, `v2mode=integrated`. Controls in the fixture bar bump the authorization revision, switch actor, drop the host token and withdraw host availability. `slow` ignores the abort signal on purpose. Default `ok` returns the fixture byte-for-byte, so the PR29 specs are unaffected.

## Tests and their limits

- `tests/components/finance-v2-async.test.tsx` (vitest/jsdom): port resolution, request contract, every identity change with an abort-ignoring port, faults, secret non-echo, timeout, retry races, revocation, host refusal, identity refusals, export, and the real `Dashboard` route. A mutation check (removing the late-answer guard) fails the timeout test.
- `tests/e2e/finance-v2-async.spec.ts` (Playwright/Chromium + axe, real keyboard retry): written against the packed fixture host. **It was not executed in the authoring checkout**: headless Chromium could not launch under the local sandbox (macOS Mach port permission denied). The package build and fixture server did start. It needs a run in a hosted/parent environment before it counts as evidence.
- Fixtures are not observations or Finance output. Passing tests prove presentation and lifecycle of synthetic data only.

## Not claimed

No Finance provider, no real authority, no canonical pin or runtime change, no Finance source moved, no amount schema change. The simulated amount strings stay the current proposal; the new `ReportingAmount` WIP is a future handshake and is not adopted here. No issue 5, 7 or 11 claim was checked against GitHub from this checkout (no GitHub remote is configured), so no overlap with an existing owner is asserted either way.
