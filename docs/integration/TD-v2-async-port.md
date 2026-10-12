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
- **Pagination is a typed, snapshot-bound continuation** (`FINANCE_V2_PAGINATION = 'snapshot-bound-cursor'`); see [Transaction paging](#transaction-paging). A static `FinanceV2View` without a connected read still fetches nothing and shows "no further page is fetched".

## Lifecycle and state accuracy

`loading` -> one of `ready`, `refused` (identity or shape), `missing`, `restricted`, `unauthorized`, `unknown`, `error` (retryable or not), `unavailable` (no usable port) or `gated` (host refusal). Only `ready` renders amounts; the rest are fixed text with no amount.

- The result is valid only for the identity it was produced for. Whenever **scope (tenant, project, environment, billing mode, actor), authorization revision, expected snapshot, query hash or summary hash** changes, the previous result is not shown even for one render (the hook returns `loading` synchronously), the in-flight read is aborted, and its answer is dropped.
- **Read generations**: the identity above also includes the **injected port object** (compared by identity, never by value). Leaving a generation (a gate or port withdrawn and restored, a port replaced, an identity A -> B -> A cycle, a retry or an unmount) aborts its read and discards its answer in the same commit, so a settled amount can never return when the same identity comes back: every new generation reads again and shows `loading` until its own answer is verified. A host must keep the port object stable while nothing changed; a new port object is a new read.
- **Token and revision**: the token callback is deliberately **not** part of the identity, so a host that passes a new function every render does not trigger a read. A change of session, membership or grant is signalled only by `authorization.revision`: the host **must change the revision in the same update** that changes what the token resolves to (including dropping it). With a new revision and no token the state is `unauthorized` at once, any in-flight read is aborted and nothing is called. The fixture host does this when its token checkbox changes. The token is never rendered, logged or put in a URL.
- **Retry focus**: the Retry button unmounts when loading starts. Focus then moves to the view heading (which is also the first element of the loading, error and result views) and stays there through the outcome, but only while focus is on `<body>` or inside that view; a place the user moved to is never taken. A hidden, empty anchor `<span hidden>` precedes the view; there is no wrapper element and no `display: contents`.
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

## Transaction paging

Fields follow `FinancialSummaryQueryV2` (`source/schema-v2.ts`, byte-pinned, never executed or edited): `cursor` (opaque, 1..2048), `pageSize` (1..500) and the snapshot id. The request is the first-page request plus `cursor?` / `pageSize?`; the host-stated snapshot id, query hash and summary hash, scope, token and revision are repeated on **every** page and each answer is checked against them again (`SNAPSHOT_MISMATCH`, `QUERY_HASH_MISMATCH`, `SUMMARY_HASH_MISMATCH`, `SCOPE_MISMATCH`).

- **Opaque cursor.** `nextCursor` is carried back verbatim as the next request's `cursor`. It is never decoded, parsed, displayed or stored by the dashboard; only its length (1..2048) and its presence are checked. `hasMore` without a usable `nextCursor`, or `nextCursor` without `hasMore`, is refused (`INVALID_SHAPE`, `/nextCursor`).
- **One page at a time.** Pages are replaced, not accumulated, and no page total is computed or invented: the summary is the one delivered for the snapshot. The history is a list of cursors plus the detail ids of the pages left behind.
- **Replay guard.** A page that repeats a detail id of an earlier page of the trail (or within itself), or whose `nextCursor` points back into the trail, is refused as `PAGE_REPLAY` without amounts.
- **Next / Previous.** Real buttons in a labelled `nav`. Both show loading (no earlier amount) and move focus to the view heading, only while focus is on `<body>` or inside the view. Previous re-reads the earlier page with a fresh authorization; no amount is cached. A second click before the render is ignored. Non-ready states (error, refused, missing, restricted, unauthorized, loading) on a continuation offer **Return to first page**.
- **Resets.** A change of scope, actor, authorization revision, host availability, snapshot or hash, port, `pageSize` or the transaction filters aborts the page in flight, drops its ignored-abort late answer and returns to the first page with an empty history (also on an A -> B -> A cycle).
- **Reload / same-tab return (private host context required).** The model library is host-agnostic: the host passes the cursor once as `initialCursor` and `onCursorChange` tells it what is requested. The raw cursor is request metadata that belongs ONLY in a private host paging context and the port request. It must never be rendered (text, href, data attribute, hidden field, accessibility label) and must never be in any URL (query, path, hash). The fixture host keeps it in one namespaced `history.state` entry together with an independently compared identity binding (all five scope fields, snapshot, query hash, summary hash, authorization revision, page size and filters) and **never a token or credential**; nothing is written to `localStorage`/`sessionStorage`. On reload, Back/Forward and remount the host restores it only if the shape is strict and every binding field equals what the host states now; a stale, malformed, forged or foreign context is discarded and the first page is read. A restored cursor grants nothing: a fresh token is requested for every read, the port decides, and the answer must still match the host's scope, snapshot and hashes. A cursor that is empty or over 2048 characters is refused before any read. A restored page is labelled "Linked page (position from the first page unknown)" and Previous returns to the first page. Same-tab detail and Back carry the current context into the new history entry; `detailHref`/`listHref` carry only the permitted non-sensitive IDs and filter state.
- **Share link / new tab.** A copied detail URL or a new tab has **no** private paging context, and no cursor or grant may be derived from a page number or URL claim. The current port can only read pages, so such a detail reads the first page and states "Transaction not in this snapshot" when the transaction is not on it; page-two deep links from a URL alone are **not supported** unless a host supplies an explicitly reviewed, host-scoped context resolver. A `?cursor=` in the address is unsupported on every mount: it is not read, not propagated, not echoed, removed from the address and answered with an explicit "Address paging is not supported" notice and no read.
- **Page evidence (TD03-R2).** For one identity-plus-filter generation the hook remembers, per request cursor (the first page included), the detail ids in order, `hasMore` and `nextCursor` of the page that was accepted. The memory survives Previous, retry and revisits (it is not the truncated trail). A revisited cursor must be answered with the same page, and a page whose rows belong to the page behind another known cursor is refused as `PAGE_REPLAY`, so the already delivered page 3 cannot be accepted as page 2. A deep-linked page can only be compared with pages observed from it onward; an unseen preceding page cannot be checked.
- **Immutable public envelope (TD03-R3).** The first accepted page of a generation fixes everything public except `requestId`, `details`, `hasMore` and `nextCursor` (as-of, timezone, period, scope, filters, watermark, summary, `detailCount`, canonical summaries and their references, hashes). Every later page (Next, Previous, retry, deep-link continuation) is compared with it by deep, key-order-insensitive value equality and refused as `SNAPSHOT_MISMATCH` with the first differing top-level path. Nothing is hashed or recomputed, and the shown values are never added up.
- **Filter generation (TD03-R1).** The filter/reset generation is part of the read identity, so a change cancels a first-page read in flight and discards a settled first page, exactly as it does for a later page.
- **INTEGRATED** accepts no port and no cursor reaches anything; real grant mapping is still pending.

### Actual captured chain (SYNTHETIC_CONFORMANCE_ONLY)

The Finance-owner-accepted handoff (producer `924cdd2`, tree `88c0bcaeaaee050678ca59261229c5f9ad1bfd13`; packet sha256 `a193d27f…fded`, owner receipt `cost-intelligence/issues/2#issuecomment-6124267724`) supplied two actual captures, committed byte for byte under `tests/fixtures/finance-v2-pagination-conformance` (digests and limits in its `PROVENANCE.json`): three pages of two details (six ordered unique ids, USD and EUR) and nine typed `ApiResult` refusals. `integration/fixture-host/finance-v2-captured.ts` (`v2port=captured`, fixture `conformance-pagination`) builds the query from the host's own trusted normalized query plus the view's request and answers with the recorded result of that exact query. A restored private-context cursor or scope claim is only a request parameter (a cursor in the address is unsupported). Cursors are never generated, altered or re-signed; they cannot be replayed outside the disposed producer host, so this is a presentation fixture, not live Finance. `FORBIDDEN_SCOPE` keeps its distinction: a scope the host did not state reads as restricted, a lost current grant (denied, stale, revoked after commit) as unauthorized. Other recorded codes (`VALIDATION_ERROR`, `IDEMPOTENCY_CONFLICT`) read as a non-retryable failure. The producer `safe_message` and `diagnostic_ref` are never read or rendered.

Limits: `integration/fixture-host/finance-v2-paged.ts` stays as the **hand-authored synthetic** chain for negative and race cases; it is not Finance output. The actual capture is not billing proof, not a grant and not a consumer ACK; the mounted Product still has no Finance grants, the optional host action mapping is not adopted, INTEGRATED stays unavailable, and CFO export remains held with the UI export disabled. The nine earlier pinned producer files are unchanged.

## Integrated mode

`mode: 'INTEGRATED'` is typed `port?: undefined`: no accepted Finance port type exists, so there is nothing to inject. At runtime it always resolves to `unavailable` and never reaches a port or fixture, even if a synthetic port is smuggled in. The hook and view import no fixture module; fixtures reach the page only through a port a host chose to inject in SYNTHETIC_PROPOSAL mode. A future accepted port needs a new, owner-accepted type; this slice does not invent one.

## CFO export

Unchanged: every view shows a restricted notice and a disabled "Export unavailable" button. There is no export port, no file, no `download` link and no success state, before or after hydration. It stays disabled until an export port is accepted by its owners.

## Fixture host

`?state=ready&v2=<fixture>` now goes through the injected port. Fixture-host-only knobs: `v2port=ok|tagged|slow|fault401|fault403|fault429|fault500|timeout|hang|flaky|none`, `v2timeout=<ms>`, `v2mode=integrated`. Controls in the fixture bar bump the authorization revision, switch actor, drop the host token (which also bumps the revision, as a real host must) and withdraw host availability. `slow` ignores the abort signal on purpose. Default `ok` returns the fixture byte-for-byte, so the PR29 specs are unaffected.

## Tests and their limits

- `tests/components/finance-v2-async.test.tsx` (vitest/jsdom): port resolution, request contract, every identity change with an abort-ignoring port, faults, secret non-echo, timeout, retry races, revocation, host refusal, identity refusals, export, and the real `Dashboard` route. A mutation check (removing the late-answer guard) fails the timeout test. Read-generation, port-replacement, fresh-token-callback and retry-focus cases were added after review of PR30 head 1c54fa5 (R1, R3, R4); 9 of them fail on that head and pass now. R2 is a fixture-host seam defect, so its reproduction is the browser case below.
- `tests/e2e/finance-v2-async.spec.ts` (Playwright/Chromium + axe, real keyboard retry): written against the packed fixture host, now also covering token revocation while a read is in flight, availability restore and keyboard retry focus. **It was not executed in the authoring checkout (all 17 cases fail before any assertion at browser launch)**: headless Chromium could not launch under the local sandbox (macOS Mach port permission denied). The package build and fixture server did start. It needs a run in a hosted/parent environment before it counts as evidence.
- Fixtures are not observations or Finance output. Passing tests prove presentation and lifecycle of synthetic data only.

## Not claimed

No Finance provider, no real authority, no canonical pin or runtime change, no Finance source moved, no amount schema change. The simulated amount strings stay the current proposal; the new `ReportingAmount` WIP is a future handshake and is not adopted here. No issue 5, 7 or 11 claim was checked against GitHub from this checkout (no GitHub remote is configured), so no overlap with an existing owner is asserted either way.
