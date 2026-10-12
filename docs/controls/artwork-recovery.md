# Reviewed artwork action recovery

Refs #17 and #15. This source-local recovery slice addresses a style Apply that
loses its response after the server definitively refuses admission, for example
when another tab has already advanced the selected artwork. The browser retains
only the scoped action identity. It must resolve that original identity before
another reviewed edit can be submitted.

## Closed result and legacy compatibility

`creative-engine/controls` exports `CreativeControlsAdapter.applyReviewedArtwork`,
`readArtworkAction`, `retryArtworkAction`, and the closed
`CreativeArtworkActionRecovery/1.0` presentation validator `assertArtworkRecovery`.
The existing `creative-apply/1.0` and `/1.1` request schemas remain unchanged.
These reviewed artwork methods accept only the existing single artwork style
task. They do not execute compound or composition tasks.

Every non-null recovery result binds its exact tenant, project and original
action ID and declares `approval:false` and `purchase:false`. The browser checks
all three identities against its current trusted schema. Unknown properties,
versions, contradictory statuses, unsafe IDs, malformed result hashes and
accessors reject without executing input code.

| Recovery | Evidence required | Presentation and next step |
| --- | --- | --- |
| `not_admitted` | Hash-checked negative receipt bound to the current scope and principal, with no admitted action sharing the identity | `status:rejected` and a closed rejection code. Refresh authority, review again and submit a new ID. |
| `terminal`, `completed` | Original controls completion and result binding, exact paired completed backend job, matching result and immutable stored DesignVersion | Minimal DesignVersion ID/artifact hash. A completed result also passes the existing `projectApplyResult` projection. |
| `terminal`, `failed` or `cancelled` | Exact paired backend job and reconciled local terminal status | No artwork result. A fresh reviewed action may be submitted after current authority is refreshed. |
| `unknown` | No negative receipt or insufficient durable terminal proof | Keep the original ID and all new edit locks. Read or explicitly retry that identity. |

Unavailable or corrupt data and revoked scoped read authority return `null`.
Neither `null`, an absent action, a rejected duplicate nor a caller-written cache
flag establishes that the original operation was not admitted. A backend ID by
itself proves no completion. The recovery projection conveys no provider,
reservation, invoice, receipt or customer data.

## Storage and concurrent admission

`ApplyStore` adds `control_artwork_rejections_v1` to its existing controls SQLite
database. The additive table works with the existing controls storage version 1.
Its primary key is the separate tenant/project/action columns. It stores the
actor, original action hash, closed rejection code and receipt hash; rejected
draft values are never stored in this journal.

The same owned `BEGIN IMMEDIATE` encloses the read of admitted actions, negative
receipt check and either admission or rejection insert. Every Apply entry point,
including legacy Apply, honors an existing negative receipt. A rejected identity
therefore cannot admit later work through another connection or through a
different entry point. A duplicate over an already admitted row never creates a
negative receipt. The current scoped read policy and original principal are
checked before a negative receipt can be written or read. Borrowed BEGIN and
SAVEPOINT transactions reject before host callbacks and remain untouched.

Read-existing recovery invokes no producer, reservation, acknowledgment or
journal mutation. Explicit Apply/retry can reconcile failed/cancelled local
outbox status only from the matched durable backend job. A known failed outbox
cannot be reopened by dispatch or relabeled by cancellation. Completed recovery
retains the original immutable receipt and remains a historical read if edit
permission is later revoked. An interrupted acknowledgment that has not produced
that original completion remains unknown; an explicit retry is required before
fresh work can be admitted. A genuinely running backend action retains its lock
and does not create another provider request or reservation on retry.

The journal is durable operation evidence. Deployment rollback must preserve the
controls database, including this table; an older writer that does not honor the
new negative journal must not write concurrently. Do not clear these records to
enable an old action ID. Use fresh authority and a newly reviewed identity.

## Browser and fixture routes

The loopback example routes `POST /api/artwork/apply`, `/api/artwork/status` and
`/api/artwork/retry` return the closed result in `recovery`. The ordinary
`/api/apply` route remains the legacy controls endpoint. The browser clears its
style uncertainty flag only after a validated `not_admitted` or `terminal`
result. Once a status read finishes, button availability is recomputed after
the busy flag is cleared. The browser stores only scoped opaque identity;
it obtains every terminal result from the server after reload. Refresh and a
separate review bind any subsequent edit to current authority.

## Verification and limits

Use pinned Node 22.23.3 and 24.15.0 with the repository's locked dependencies:

```sh
node --test --test-reporter=tap tests/controls/artwork-recovery.test.mjs
node fixtures/controls/check.mjs --types --out build/artwork-controls-evidence.json
node examples/frontend-action-roundtrip/node_modules/typescript/bin/tsc -p tests/controls/types/tsconfig.json
node fixtures/controls/installed-composition-check.mjs --evidence-dir build/artwork-installed-consumer
cd examples/frontend-action-roundtrip
node node_modules/@playwright/test/cli.js test tests/composition.spec.mjs --project=actual-api
```

The tests cover stale/lost responses, a real fresh-process reopen, fresh style
success, original-ID retry, no duplicate reservations, same-database concurrent
connections, pending duplicate refusal, current scope/principal/read permission,
borrowed transactions, failed/cancelled backend jobs and corrupted persistence.
The installed consumer uses a newly packed package with no source aliases and
closed positive/negative TypeScript consumers. Browser cases cover response loss,
reload/read/retry and fresh review, plus unknown-before-admission and forged
cache negatives. Those browser cases require actual Chromium execution; source
coverage or test discovery alone does not satisfy that gate.

All provider/Finance/rights/membership inputs in these checks remain explicit
offline MOCK fixtures. Tests use the genuine local API and SQLite stores but
make no live provider or production calls. Graceful reopen is not crash evidence.
This slice grants no external issuer approval, consumer acceptance, deployment,
release-gate completion or owner adoption of the cumulative controls branch.
