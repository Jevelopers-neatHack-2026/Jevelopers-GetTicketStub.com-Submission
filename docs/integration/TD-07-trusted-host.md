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

## Fail-closed rules

| Condition | Decision | Guarded read |
| --- | --- | --- |
| Missing, malformed or non-string credential (including a `HostAccess` projection) | `denied/unauthenticated`, verifier not called | `restricted`, reader not called |
| Verifier says `missing`, `malformed`, `forged`, `unsupported_version`, `expired`, `wrong_audience`, `revoked` or `stale` | `denied/unauthenticated` | `restricted` |
| Verifier says ok, but the audience differs or `expiresAt` has passed (re-checked here) | `denied/unauthenticated` | `restricted` |
| Requested project differs from the verified project, or is not a safe identifier | `denied/not_found` (indistinguishable from nonexistent) | `restricted` |
| Verified context lacks a route's required capability | `denied/forbidden` | `restricted` |
| Unknown route id | `denied/not_found` | unknown path is `unavailable` |
| Verifier throws, times out (default 5 s, aborts its signal), says `unavailable`, or returns a malformed answer | `unavailable` | `unavailable` |
| Reader throws / returns a malformed or `loading` state / request aborted | — | `error` (retryable) / `error` (not retryable) / `unavailable` |

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
const readRoute = createGuardedRouteReader({ authorizer, basePath: agreedAdminPrefix, read: hostFinanceRead });

// Page render: send only the display projection to the client.
const access = toHostAccessProjection(await authorizer.authorize({ credential: serverHeldCredential, route }));
// Read handler: the browser sends a pathname; the host attaches the credential itself.
const state = await readRoute({ credential: serverHeldCredential, pathname, signal });
```

`hostSessionVerifier`, `hostDashboardAudience`, `serverHeldCredential` and `hostFinanceRead` are host-injected. This package reads no environment variables and defines none.

## Tests

`tests/access/trusted-host.test.ts` (node) and `tests/access/forged-projection.test.tsx` (jsdom, mounted `Dashboard`) use `tests/fixtures/host-verifier.ts`, an HMAC test double with a published non-secret key that models session, membership and revision re-checks. They cover allow/deny per route, role-name independence, every fail-closed row above, project selection, revocation between reads, and forged `HostAccess` as object, JSON, base64, unsigned token and as a smuggled field. A forged projection naming another tenant renders either restricted or the caller's own verified data, never the victim canary.

## Owner decisions needed

1. **Verifier implementation and credential.** Which host mechanism implements `HostSessionVerifier`: the GT-08 signed context (`ticketstub.context/2`, PR #42) verified in-process, a call to `POST /api/context/verify`, or a direct session-store lookup. Also, what string the host passes as the credential.
2. **Audience value.** PR #42 proposes `ticketstub.finance`; it is used here only in tests.
3. **Permission matrix acceptance** (TD-07.A). Host and Finance must accept the route → capability mapping above, including whether detail routes need a separate private-detail grant and whether `finance-admin`/read-only roles are adopted.
4. **Field redaction contract** (TD-07.B). Which fields each grant may see; the reader receives `capabilities` to apply it, but no redaction policy is defined here.
5. **Project selection.** How the host maps a dashboard URL to a `projectId` request (PR #42 uses `?project=kind:id` on the context endpoint).

## Not covered

Actual host wiring and `npm run test:host` (still `BLOCKED`), audited commands and actor audit history (TD-07.D/E), field-level redaction, client cache clearing on logout beyond the existing revision-keyed aborts, and live identity evidence.
