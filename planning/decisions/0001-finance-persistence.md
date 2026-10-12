# Decision 0001: Production finance persistence

- Status: **proposed; owner decision required.** Nothing here is accepted or implemented. No account was created and no terms were accepted.
- Tracker: [getticketstub.com#27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27), "Select and integrate production finance persistence". Related: LIVE-02 (restore), BUD-01..04, FIN-01..10 in the [acceptance checklist](../acceptance-checklist.md).
- Decider: Finance and reliability owner (CompleteDotTech). Implementation in `cost-intelligence` stays with its owners; the CI-05A/B reservation authority ([#12](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/12), [#13](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/13)) is unaffected by this memo.
- Date: 2026-10-11

## Context

- **The finance package is PostgreSQL-specific.** `cost-intelligence` migrations `0003`-`0005` use schema `cost_intelligence`, `jsonb` with `jsonb_typeof` checks, `numeric(58,18)` amounts, and `BEFORE UPDATE OR DELETE` / no-truncate triggers that make the ledger append-only. `src/ledger/store.ts` and `src/pricing/store.ts` rely on `pg_advisory_xact_lock` plus `SELECT ... FOR UPDATE` under `READ COMMITTED`, and `REPEATABLE READ READ ONLY` for reads. Tests run against a digest-pinned `postgres:16`.
- **It is a library, not a service.** `docs/api/ledger.md` says the host injects a connection from a host-managed PostgreSQL pool; the package opens no pool of its own (`examples/worker-composition.ts`). So the database must be reachable from the process that composes it: today, the getticketstub.com Next.js server on GoDaddy Plus Launch.
- **`CI_TEST_DATABASE_URL` is not a production setting.** `scripts/with-postgres.mjs` only accepts a target that already carries `ci_test.disposable_database_marker` (`cost-intelligence-disposable-v1`) and needs CREATEDB/DROP rights. A production database must never carry that marker.
- **The customer app is SQLite.** `node:sqlite` at `TICKETSTUB_DB=/private/ticketstub.sqlite`, WAL, one writer. ADR 0001 says SQLite pins the app to one instance. Preview and Publish share the same `/private`. Survival across restart and redeploy is still unverified (#27). Backups are weekly `VACUUM INTO` files under `/private/backups`, downloads under 25 MB.
- **The architecture kit** (`architecture.md` section 3) already plans "PostgreSQL ... durable records and a job queue".
- **Host database.** GoDaddy's Node.js hosting page advertises a managed **MySQL** database. We found no PostgreSQL offering (the page returned 403 to our fetch, so this comes from search results; confirm in the dashboard).

## Options

| Option | Fit with cost-intelligence | Operations | Main risk |
| --- | --- | --- | --- |
| A. SQLite on `/private` | None. It would mean rewriting the triggers, numeric, jsonb and advisory-lock concurrency, and dropping the tested Postgres 16 path. | Free, already mounted | Correctness rewrite. Preview and Publish share a file. Single writer. Restore unproven. |
| B. Host's managed MySQL | None. Same rewrite in a different dialect. | Bundled with host (check current pricing) | Same as A. Also not what the tests run. |
| C. **Neon** managed Postgres | Full. Supports 14-18 (16.15 as of Aug 2026). Region selectable. | Usage-based Free / Launch / Scale plans (check current pricing). PITR history window: Free 6 h, Launch up to 7 days, Scale up to 30 days. Uptime SLA on Scale only. | Free tier scales to zero after 5 min (cold start on first ledger write). Pooled endpoint is PgBouncer **transaction mode**. |
| D. **Supabase** Postgres | Full Postgres | Free / Pro / Team (check current pricing). Daily backups on Pro (7 days), none on Free. PITR add-on priced separately. | Direct host is IPv6-only unless you buy the IPv4 add-on. From an IPv4-only host you must use the Supavisor session pooler. Extra platform surface (auth, storage) we don't need. |
| E. Self-managed Postgres (VPS / container) | Full | Owner runs patching, backups, TLS | Operational load the team hasn't staffed |

Connection notes (from the provider docs):

- Neon's transaction pooler breaks session state: `SET`, session advisory locks, SQL `PREPARE`, `LISTEN`.
- `pg_advisory_xact_lock` is transaction-scoped, so it is compatible in principle. That still has to be proven by running the ledger suites against the pooled endpoint.
- Run migrations on the **direct** endpoint.

## Recommendation

**Option C: Neon Postgres 16, on a paid tier that includes a PITR window (Launch or higher), in a North America region near the host.**

- Keep finance data in its own database, separate from the customer-app SQLite. This keeps single data ownership (ARC-02) and leaves the app's storage migration as a separate decision.
- Use the **direct** endpoint for migrations, and the direct endpoint or a small app-side `pg` pool for the ledger at hackathon volumes. Use the pooled endpoint only after the ledger and pricing suites pass against it.

Supabase (D) is the fallback if the owner already has an account there. It requires session-mode pooling or the IPv4 add-on.

SQLite (A) and MySQL (B) are rejected because they would discard the tested correctness design.

## Consequences

- Finance writes leave the host. Ledger availability now depends on network and Neon uptime. The ledger already fails closed when unavailable (architecture section 6: stop billable work that cannot be accounted for).
- Two backup domains: Neon PITR for finance, and SQLite `VACUUM INTO` for the app. LIVE-02 must restore both to a consistent point and record it.
- Credentials are a new production secret, stored only in the GoDaddy environment (Preview and Publish). **Use separate Neon branches or databases for Preview and Publish.** They share `/private`, so they must not share a finance database.
- A Free-tier cold start adds latency to the first write after idle. Acceptable for demos, but not on a live checkout path.
- The composition (host-injected pool, adapter in getticketstub.com) still has to be built. It is blocked behind CI-05A/B for reservations, but the ledger and pricing stores can be wired first.

## Owner actions

1. **Decide:** Neon (recommended), Supabase, or another option. Also decide the plan tier and region.
2. **Account and terms:** create the provider organization under the company identity and accept its terms of service and data processing addendum yourself. Agents must not do this. Check current pricing and set a spend cap or alert.
3. **Create** project `cost-intelligence`, Postgres **16**, with two databases or branches (`preview`, `production`). Each gets a least-privilege application role (no CREATEDB, no superuser) and a separate migration role. **Do not** add the disposable-database marker.
4. **Secrets:** put the connection strings into GoDaddy Preview and Publish environment variables under a production name such as `FINANCE_DATABASE_URL` (the name is final once the adapter PR fixes it). Never use `CI_TEST_DATABASE_URL` for this, and never paste values into issues or evidence.
5. **Backups:** confirm the PITR window. Approve a restore rehearsal for LIVE-02.
6. **Then:** authorize the adapter and migration PRs (cost-intelligence owners, getticketstub.com composition) and a run of the ledger/pricing suites against a *separate disposable* branch.

## Sources

- Neon connection pooling: https://neon.com/docs/connect/connection-pooling
- Neon plans: https://neon.com/docs/introduction/plans (check current pricing)
- Neon Postgres versions: https://neon.com/docs/postgresql/postgres-version-policy
- Supabase connecting: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase backups: https://supabase.com/docs/guides/platform/backups (check current pricing)
- GoDaddy Node.js hosting: https://www.godaddy.com/hosting/nodejs (lists managed MySQL; confirm in dashboard)
