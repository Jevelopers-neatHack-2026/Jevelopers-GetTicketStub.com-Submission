# TD-07 trusted host authorization seam

Status: local, provider-agnostic server seam with an offline test double. **Not** host-accepted. No identity provider, session store, signing key or endpoint is chosen or shipped here. Tracks the getticketstub.com #27 item "Integrate trusted host session, membership and team authorization into `team-dashboard`; browser `HostAccess` projections are not credentials", and parts of [TD-07 #11](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/11) and [TD-01 #3](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/3).

## Trust boundary

```text
browser                      host server (getticketstub.com)                 this package (server entry)
Dashboard ── route read ──▶  attaches its own server-held credential ──▶  createGuardedRouteReader
  access = HostAccess          (e.g. signed context from httpOnly session)     └ DashboardAuthorizer
  (display only)                                                                 └ HostSessionVerifier (host-injected)
                                                                                 └ read({ verified scope }) ──▶ finance read port
```

- **Only the injected `HostSessionVerifier` turns a credential into identity, membership and grants.** The host implements it and must re-check the live session, project membership and membership revision on every call.
- The credential is an opaque string that the **host server** holds. A `HostAccess` value, any object, a non-string, an empty or padded string, or a string with whitespace/control characters is rejected before the verifier is called.
- `HostAccess` stays a display projection. `toHostAccessProjection` produces it from a server decision; nothing in the server entry accepts it as input. The guarded read input has no scope or access field, and extra fields are ignored.
- Every read is re-authorized. Scope passed to the host read function always comes from the verified context.
- **Forgery resistance for string credentials rests on the host verifier.** This package rejects every non-string and every non-opaque string before the verifier runs. A JSON, base64 or unsigned-token string that *looks* like a credential is passed to the verifier, and only the verifier's signature, session and membership checks reject it. The tests prove that rejection against the HMAC fixture, not against a production verifier.

## Verifier answers are untrusted shape

The authorizer snapshots the verifier's answer before it validates anything:

- Each field (`ok`, `reason`, `context`, and each context field) is read **exactly once** into a local, from an **own data property** (`Object.getOwnPropertyDescriptor`). Accessors (getters) are rejected without being invoked. Inherited values, including a polluted `Object.prototype`, are never read. A throwing Proxy trap fails closed.
- `capabilities` must be a real array (`Array.isArray`) with an own integer `length` of at most 256. It is copied by index into a fresh array (`Array.from({ length }, …)`) **before** any element is validated, so an overridden `every`, `Symbol.iterator` or `length` getter cannot skip validation. Holes fail. Duplicates are removed.
- Only the snapshot is validated and used. The decision, its `scope`, `trustedScope` and `capabilities` are fresh frozen objects. Unknown fields are dropped.

## Expiry and context lifetime

- `expiresAt` must be a strict ISO-8601 instant: `YYYY-MM-DDTHH:MM:SS[.mmm]` followed by `Z` or an explicit `±HH:MM` offset. An offset-less local time, a date-only value, RFC 2822 text and out-of-range fields are a malformed answer (`unavailable`). Parsing never consults the server's timezone (`parseInstant`). Tests run the same rows under `TZ=UTC` and `TZ=America/Los_Angeles`.
- `maxContextTtlMs` caps how far in the future `expiresAt` may be: a context claiming `expiresAt > now + maxContextTtlMs` is denied (`lifetime_exceeded`). Default **15 minutes** (PR #42 issues 5-minute tokens). Configurable as an integer in [1 000, 86 400 000] ms (1 s to 24 h); anything else throws at construction.
- `timeoutMs` (verifier) and `readTimeoutMs` (host read) must be integers in [1, 60 000] ms. Defaults: 5 000 and 10 000 (the read deadline sits below the dashboard's 15 s client timeout). `NaN`, `0`, negatives, fractions and `Infinity` throw.

## Finance scope (`environment`, `billingMode`)

The verified context must carry `environment` (`development` | `test` | `production`) and `billingMode` (`live` | `sandbox` | `simulated`), the vocabulary of cost-intelligence's `TrustedScope` (vendored in getticketstub.com PR #42 as `fixtures/context/finance-trusted-scope.schema.json`) and the shared-contracts common envelope (`environment`, `billing_mode`). A missing or unknown value is a malformed answer (`unavailable`).

The verifier maps the host's `/2` modes onto this vocabulary with `ticketstub.finance-scope-adapter/1` (PR #42): `development`/`preview`/`live` → `development`/`test`/`production`; `none`/`sandbox`/`paid_test`/`live` → `simulated`/`sandbox`/`live`/`live` (a paid test is real spend). `evidenceMode` is not carried here.

An allowed decision exposes `trustedScope`, exactly the five `TrustedScope` fields (`tenantId`, `projectId`, `environment`, `billingMode`, `actorId`), and the guarded reader passes it to `read`. **A host read must take the billing mode and environment from `trustedScope`, never from env or request state.**

## Revision and the authorize-to-read window

- `revision` is an opaque string that changes whenever session, membership or grants change. PR #42's `/2` context has `membershipRevision: number` and no `revision` string. The verifier owns the mapping. The fixture and the recommended mapping are `` `${actorId}@${membershipRevision}` ``, which changes on every bump of the account's monotonic `membershipRevision`.
- `TrustedReadRequest` carries the verified `revision` and `expiresAt`.
- **Residual window.** Between the verifier's answer and the end of the host read, a revocation can land. The window is bounded by one verifier round-trip (≤ `timeoutMs`) plus the read (≤ `readTimeoutMs`), so ≤ 15 s by default. The guarded reader aborts the read's signal at the deadline and returns `unavailable`.
- **Host obligation.** Where the store allows, the host read must re-check the revision in the same transaction or query as the read (for #42: the account's `membershipRevision` still equals the verified value, and the session is still live). It must return `restricted` when the check fails. A host that cannot do this accepts the window above and must say so in its integration evidence.

## Object-level authorization on detail routes

`transaction-detail` and `event-detail` hand the URL id (`route.params.id`) to `read` next to the verified scope. The id is caller-chosen and untrusted. The host read must:

1. Scope the lookup by `scope.tenantId` and `scope.projectId` (or `trustedScope`), for example `WHERE id = $id AND tenant_id = $tenant AND project_id = $project`. It must never look the record up by id first and compare afterwards in a way that changes the answer.
2. Return **one and the same state** for "the id exists but belongs to another tenant or project" and "the id does not exist". `empty` is recommended. The response must not differ in status, body, timing class or error. Otherwise the id becomes a cross-tenant existence oracle.

`tests/access/trusted-host.test.ts` ("object-level authorization on detail routes") forges victim transaction ids, a same-tenant other-project id, encoded tenant and project refs, and a victim event id. It asserts each result deep-equals the nonexistent-id result. The mounted test does the same through `Dashboard`. These tests cover a compliant fixture reader. The rule binds the real host read, which this package cannot enforce.

## Denial cause and audit

Denied and unavailable decisions carry a server-only `cause` (`revoked`, `stale`, `expired`, `forged`, `wrong_audience`, `malformed`, `unsupported_version`, `missing`, `invalid_credential`, `lifetime_exceeded`, `project_mismatch`, `missing_capability`, `unknown_route`; or `timeout`, `aborted`, `verifier_error`, `verifier_unavailable`, `malformed_answer`). `toHostAccessProjection` drops it. The guarded reader never returns it. Instead it reports a `GuardedReadOutcome` (cause, route, actor, revision, read result) to an optional server-only `onOutcome` hook. Exceptions thrown by the hook are ignored. **Never forward a cause to the browser.** Use it for logs, audit (TD-07.E), and choosing between re-authentication and refresh.

## Guarded read result

`createGuardedRouteReader` returns `{ state, access }`. `state` is the `RouteState` for the browser. `access` is the `HostAccess` projection of the decision that served this read, so it carries the verified scope and revision. Send both. The client can then discard data whose `access` does not match the projection it rendered with, and it never labels data with a stale or forged scope.

## Fail-closed rules

| Condition | Decision | Guarded read |
| --- | --- | --- |
| Missing, malformed or non-string credential (including a `HostAccess` projection) | `denied/unauthenticated`, verifier not called | `restricted`, reader not called |
| Verifier says `missing`, `malformed`, `forged`, `unsupported_version`, `expired`, `wrong_audience`, `revoked` or `stale` | `denied/unauthenticated` | `restricted` |
| Verifier says ok, but the audience differs or `expiresAt` has passed (re-checked here) | `denied/unauthenticated` | `restricted` |
| Verifier says ok, but `expiresAt` is beyond `now + maxContextTtlMs` | `denied/unauthenticated` (`lifetime_exceeded`) | `restricted` |
| Requested project differs from the verified project, or is not a safe identifier | `denied/not_found` (indistinguishable from nonexistent) | `restricted` |
| Verified context lacks a route's required capability | `denied/forbidden` | `restricted` |
| Unknown route id | `denied/not_found` | unknown path is `unavailable` |
| Verifier throws, times out (default 5 s, aborts its signal), says `unavailable`, or returns a malformed answer (including a non-strict `expiresAt`, a getter, or a missing `environment`/`billingMode`) | `unavailable` | `unavailable` |
| Reader throws / returns a malformed or `loading` state / exceeds `readTimeoutMs` (default 10 s, aborts its signal) / request aborted | — | `error` (retryable) / `error` (not retryable) / `unavailable` / `unavailable` |

Identifiers must match `^[\w.:-]{1,128}$` (the host's kind-prefixed ids, e.g. `account:…`, `event:…`). Capabilities must be lowercase dotted strings.

## Permission matrix (`team-dashboard.permissions/1`, proposed)

Decisions consult explicit capability strings, never `role`. The strings follow the host's GT-FIN-001 proposal in [getticketstub.com PR #42](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/42) (unmerged).

| Routes | Required capabilities |
| --- | --- |
| overview, ai-costs, sales, fulfillment, budgets, transactions, transaction-detail, events, event-detail, reports | `finance.read` |
| exports | `finance.read`, `finance.export` |

`finance.command.*` is not consumed: no command UI exists yet (TD-07.D).

## Host usage

```ts
// Server-only code in the host. Never import '@jevelopers/team-dashboard/server' in a client component.
import { createDashboardAuthorizer, createGuardedRouteReader, toHostAccessProjection } from '@jevelopers/team-dashboard/server';

const authorizer = createDashboardAuthorizer({ verifier: hostSessionVerifier, audience: hostDashboardAudience });
const readRoute = createGuardedRouteReader({ authorizer, basePath: agreedAdminPrefix, read: hostFinanceRead, onOutcome: hostAuditLog });
// hostFinanceRead({ route, scope, trustedScope, revision, expiresAt, signal }): scope every lookup by `scope`,
// take billing mode and environment from `trustedScope`, re-check `revision` in the read, honour `signal`.

// Page render: send only the display projection to the client.
const access = toHostAccessProjection(await authorizer.authorize({ credential: serverHeldCredential, route }));
// Read handler: the browser sends a pathname; the host attaches the credential itself.
// `access` is the projection of the decision that served this read; send it with `state`.
const { state, access: readAccess } = await readRoute({ credential: serverHeldCredential, pathname, signal });
```

`hostSessionVerifier`, `hostDashboardAudience`, `serverHeldCredential`, `hostFinanceRead` and `hostAuditLog` are host-injected. This package reads no environment variables and defines none.

## Tests

`tests/access/trusted-host.test.ts` (node) and `tests/access/forged-projection.test.tsx` (jsdom, mounted `Dashboard`) use `tests/fixtures/host-verifier.ts`, an HMAC test double with a published non-secret key that models session, membership and revision re-checks. They cover:

- allow and deny per route, and role-name independence
- every fail-closed row above, with its server-only cause
- strict expiry under `TZ=UTC` and `TZ=America/Los_Angeles` (offset-less, RFC 2822, date-only, explicit offset, far future), and the lifetime cap
- untrusted-shape answers: a getter that changes value, a Proxy (read once, throwing trap, huge `length`), an array with an overridden `every` or iterator, an array-like, a sparse array, and a polluted `Object.prototype` (cleaned up in `finally`)
- capability de-duplication and dropping of unknown fields
- bounded timeouts, the read deadline, and an outer signal aborted while the verifier is in flight
- project selection, revocation between reads, and forged detail ids (object-level rule)
- forged `HostAccess` as an object, JSON, base64, an unsigned token and a smuggled field

The mounted test runs on both the overview and a transaction-detail path. A forged projection naming another tenant renders either restricted or the caller's own verified data, never the victim canary, and the read result's `access` carries the verified scope. The string-form cases prove the fixture verifier's checks only. See "Trust boundary".

## Owner decisions needed

1. **Verifier implementation and credential.** Which host mechanism implements `HostSessionVerifier`: the GT-08 signed context (`ticketstub.context/2`, PR #42) verified in-process, a call to `POST /api/context/verify`, or a direct session-store lookup. Also, what string the host passes as the credential.
2. **Audience value.** PR #42 proposes `ticketstub.finance`; it is used here only in tests.
3. **Permission matrix acceptance** (TD-07.A). Host and Finance must accept the route → capability mapping above, including whether detail routes need a separate private-detail grant and whether `finance-admin`/read-only roles are adopted.
4. **Field redaction contract** (TD-07.B). Which fields each grant may see; the reader receives `capabilities` to apply it, but no redaction policy is defined here.
5. **Project selection.** How the host maps a dashboard URL to a `projectId` request (PR #42 uses `?project=kind:id` on the context endpoint).
6. **Finance vocabulary and revision.** Finance must accept the `environment`/`billingMode` mapping (`ticketstub.finance-scope-adapter/1`) and the `revision` derivation from `membershipRevision`. The host must also decide whether its read re-checks the revision transactionally or accepts the documented residual window.
7. **Context lifetime cap.** Whether 15 minutes is the right default for `maxContextTtlMs`.

## Not covered

Actual host wiring and `npm run test:host` (still `BLOCKED`), audited commands and actor audit history (TD-07.D/E), field-level redaction, client cache clearing on logout beyond the existing revision-keyed aborts, and live identity evidence.
