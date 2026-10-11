# Context fixtures (`ticketstub.context/1`)

Sanitized, deterministic examples of the signed request context that `getticketstub.com` issues to downstream consumers (team-dashboard, cost-intelligence). No real account, email or session appears in them: every id is `*_FIXTURE_*` or `fx...`.

> **FIXTURE ONLY. NEVER PRODUCTION.** `fixture-key.json` holds the HMAC key these tokens are signed with. It is public on purpose. Tokens made with it say `"mode": "fixture"`. No deployment is configured with it, so a production verifier using its own key rejects every one of them as `forged`. Fixture success shows a consumer reads the format. It does not show integration with the live issuer.

## Token format

```
base64url(header) . base64url(payload) . base64url(signature)
header    {"alg":"HS256","typ":"ticketstub.context"}
payload   {"ctx": <RequestContext>, "sid": <string or null>}
signature HMAC-SHA256(key, base64url(header) + "." + base64url(payload))
```

`ctx` is the `RequestContext` of `src/server/context-token.ts`:

| Field | Meaning |
| --- | --- |
| `schema` | `ticketstub.context/1`. Anything else is `unsupported_version`. |
| `actor` | `{kind:"account",id}`, `{kind:"guest",id}` or `{kind:"anonymous"}` |
| `tenant.id` | account id, or `guest:<id>` |
| `project` | `{kind:"stub"\|"event", id}`, when the context is for one project |
| `role` | `owner`, `captain`, `member`, `viewer`, `staff`, `none` |
| `capabilities` | what this actor may do here, from the matrix below |
| `membershipRevision` | the account's counter. It rises when the email changes, on sign-out everywhere, and when staff status changes. |
| `revoked` | true if the session behind it was revoked when issued |
| `environment`, `mode` | `development`/`preview`/`live`, and `fixture`/`sandbox`/`live` |
| `issuedAt`, `expiresAt` | ISO. The lifetime is 5 minutes. |

`sid` is a non-secret reference to the session the context came from (null for guests). The issuer uses it to tell whether the session is still live.

## Capability matrix

| Actor and role | Capabilities |
| --- | --- |
| Everyone (anonymous, guest, account) | `stub.draft` `art.generate` `agent.use` `share.create` `share.view` `wall.public.view` `claim.view` `file.read` `order.create` |
| Account, any role | the row above and `account.read` `account.email.change` `account.delete` `session.revoke` `wall.sync` `wall.publish` `order.read` `event.create` `claim.redeem` |
| `owner` of a stub | `stub.read` `stub.write` `share.revoke` `gift.create` |
| `captain` of an event | `event.read` `event.publish` `claims.read` |
| `member`, `viewer` | `stub.read` on a stub, `event.read` on an event (modelled, never issued yet) |
| `staff` (account on `ADMIN_EMAILS`) | `admin.view`, and no project access |
| `none` on a project | nothing beyond the first row |

The matrix is `CAPABILITY_MATRIX` in `src/server/context-token.ts`. The smoke test checks every fixture against it, and checks this table lists every capability.

## Fixtures

Each file is `{fixture, description, verifyAt, token, state?, expect}`. Verify at `verifyAt` (not the wall clock) with the fixture key and `state`, and expect `expect`.

| File | Expect |
| --- | --- |
| `owner.json` | ok, role `owner` on `stub:stub_fx_1` |
| `captain.json` | ok, role `captain` on `event:evt_fx_1` |
| `staff.json` | ok, role `staff`, `admin.view`, no project |
| `guest.json` | ok, actor guest, role `none`, no account capabilities |
| `unknown.json` | ok, actor anonymous, role `none`: a valid token that grants nothing private |
| `malformed.json` | `unknown` (not a token) |
| `forged.json` | `forged` (signed with another key) |
| `stale.json` | `stale` (state revision 4, token says 3) |
| `revoked.json` | `revoked` (state `sessionLive: false`) |
| `expired.json` | `expired` (issued ten minutes before `verifyAt`) |
| `unsupported-version.json` | `unsupported_version` (schema `ticketstub.context/2`, validly signed) |
| `cross-project-a.json`, `cross-project-b.json` | ok. The same user on `stub_fx_1` and on `stub_fx_2`. A token for one must not authorize the other. |
| `tenant-a-owner.json`, `tenant-b-owner.json` | ok. Two tenants, each owning a stub called `stub_fx_shared`. Key every lookup by tenant **and** project. |

Regenerate with `node fixtures/context/generate.mjs` (deterministic). Check with `node fixtures/context/verify.mjs`.

## How a consumer verifies

1. **Signature, version, expiry (offline).** Copy `verifyContext(token, key, {now, state})` from `verify.mjs`. It has no dependencies. It checks, in this order: shape (`unknown`), HMAC in constant time (`forged`), schema (`unsupported_version`), expiry (`expired`), and, when `state` is given, session (`revoked`) then revision (`stale`).
2. **Stale and revoked (needs the issuer).** `state` is `{ membershipRevision, sessionLive }` for the token's account, which only the issuer knows. Get it by calling the issuer's `POST /api/context/verify` with `{token}` on every mutation, read, retry, import, job, export and download (200 with the context, or 401 with `{ok:false, reason}`), or have the issuer push the state.
3. **Bind it to the request.** After the token is good, check `authorizes(ctx, {tenant, project, capability})`: `ctx.tenant.id`, `ctx.project` and the capability must match the tenant, project and action being asked for. A tenant, project, role, filter, cursor, correlation id or signed evidence reference supplied by the caller grants nothing.
4. **Fail closed.** Unknown, forged, stale, revoked, expired and unsupported-version are all denials. A denied mutation must change no state. Never show the existence of a project the token does not cover: answer as if it were not there.
5. **Do not mint, widen or cache past `expiresAt`.** The consumer is not an identity authority.

Production consumers hold the issuer's `CONTEXT_SECRET`-derived key through their own secret store. It is never in this folder, and the fixture key must never be set as `CONTEXT_SECRET`.

## Context `/2` and finance fixtures (`v2/`)

`ticketstub.context/2` is the version for finance consumers. `/1` and everything above is unchanged and still verifies. Why a new version, the grant matrix, the mode mapping and the GT-FIN-001..003 map are in `docs/architecture/identity.md` ("Context /2 and the finance handoff"). Same token format and key, same fixture-only warning: **the fixtures prove a consumer can read the format, not that the live issuer is integrated, and Finance has not accepted the grant matrix or the mode mapping.**

What changes in `ctx`:

| Field | `/2` |
| --- | --- |
| `actor.id`, `tenant.id` | Kind-prefixed and equal: `account:<id>`, `guest:<id>`, `anonymous:0`. Two kinds never collide. |
| `project` | `{kind, id, ref}`, `ref` is `<kind>:<id>` |
| `environment` | `development`, `preview`, `live`: where it runs |
| `economicMode` | `none`, `sandbox`, `paid_test`, `live`: whether real money is at stake. `paid_test` is real money spent in testing, an actual expense. |
| `evidenceMode` | `fixture`, `synthetic`, `live`: what kind of record backs it |
| `issuer`, `audience` | `getticketstub.com`, and the host the token is for |
| `capabilities` | the `/1` capabilities plus explicit `finance.*` grants. The role is informational. |

Finance grants: `finance.read`, `finance.export`, `finance.command.budget_change`, `finance.command.expense_adjust`, `finance.command.reservation`, `finance.command.reconcile`, `finance.command.recovery`. An event captain holds read and export on that event. An event member (never issued yet) holds read. A stub owner, a guest and an ordinary account hold none. Staff hold every grant in the platform scope (a context with no project) and nothing on a project they do not hold.

| File in `v2/` | Expect |
| --- | --- |
| `finance-read-allowed.json`, `finance-read-denied.json` | captain holds `finance.read`; a stub owner holds no finance grant |
| `finance-export-allowed.json`, `finance-export-denied.json` | captain holds `finance.export`; an event member does not |
| `finance-command-allowed.json`, `finance-command-denied.json` | staff in the platform scope hold every `finance.command.*`; the captain holds none |
| `finance-guest-denied.json` | a guest holds no finance grant |
| `injective-account.json`, `injective-guest.json` | the same raw id as `account:` and as `guest:`: different actor and tenant |
| `economic-sandbox.json`, `economic-none.json`, `economic-paid-test.json`, `economic-live.json` | each carries its three modes and the proposed finance scope. `economic-paid-test` is `preview` / `paid_test` / `fixture`: billingMode `live`, an actual expense. |
| `wrong-audience.json`, `right-audience.json` | verified with `audience` set to another host, `wrong_audience`; with the right one, ok |
| `revoked-membership.json` | `revoked` (state `sessionLive: false`) |
| `project-membership-removed.json` | `revoked` (state `projectMember: false`: the account no longer holds the project) |
| `stale-revision.json` | `stale` |
| `malformed-shapes.json` | 40 validly signed contexts, each malformed in one field, every one `unknown`. This includes the seven shapes the Finance receipt found passing the old offline verifier (missing actor id, missing or unknown environment, missing or unknown mode, malformed project kind or id, missing `issuedAt`), and the `/2` shapes: unprefixed or wrongly prefixed ids, tenant not equal to actor, missing or unknown economic or evidence mode, `paid_test` from a live environment, live money from development, a project ref that does not match, a finance grant held by a guest, an unknown `finance.*` string. |

`verify.mjs` adds, for `/2`: `verifyContext(token, key, {now, state, audience})`, where `state` may carry `projectMember`; `authorizesFinance(ctx, {tenant, project?, capability, expect?})`, which reads only `capabilities`, binds tenant and project scope exactly, refuses `/1`, and, when `expect` pins the three modes, refuses a mismatch; and `toFinanceScope(ctx)`, the proposed mapping onto Finance's `TrustedScope` (`null` means no honest mapping: deny).

`verify.mjs` and the server run the same shape rules. `tests/finance-context.test.mjs` requires identical answers on every malformed input, and `npm run verify:product -- --suite finance-context` posts the same corpus to `POST /api/context/verify` on a running server and compares. To select a project: `GET /api/context?v=2&project=event:<id>` with the user's session. The server proves the selection from its own records, and a project the caller does not hold is a `404`. `POST /api/context/verify` accepts `{token, audience?}` and re-checks session, project membership, revision, audience and modes at that moment.

`corpus.mjs` holds the malformed corpus as data, so each caller signs it with its own key. Regenerate with `node fixtures/context/generate.mjs`; check with `node fixtures/context/verify.mjs`.
