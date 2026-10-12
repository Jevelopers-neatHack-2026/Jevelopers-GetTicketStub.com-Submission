# Decision 0001: Production finance persistence

- Status: **accepted (owner-delegated 2026-10-12).** See [0003](0003-owner-delegated-decisions-2026-10-12.md) rows P1-P3. Sub-choices made: Neon (Option C), Postgres 16, Launch plan; region `aws-us-east-1` (or `aws-us-west-2` if the dashboard shows a western host origin); scale to zero disabled on `production`, kept on `preview`. Supabase stays the fallback only. Accepting the decision executed nothing: no account was created, no terms were accepted and no database exists. Owner actions 2-6 below remain owner-only.
- Tracker: [getticketstub.com#27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27), "Select and integrate production finance persistence". Related: LIVE-02 (restore), BUD-01..04, FIN-01..10 in the [acceptance checklist](../acceptance-checklist.md).
- Decider: Finance and reliability owner (CompleteDotTech). Implementation in `cost-intelligence` stays with its owners; the CI-05A/B reservation authority ([#12](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/12), [#13](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/13)) is unaffected by this memo.
- Date: 2026-10-11

## Context

Source observations below are pinned to [getticketstub.com `6de6fdf`](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/tree/6de6fdf60ae5365c2fe4b4ab65a43c62a2ab6ca7) and [cost-intelligence `bc570fb`](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/tree/bc570fbb9db005c727c90c0a83fd6b4f99caebe7), observed 2026-10-12 UTC. They describe those revisions, not later main-branch changes or operational acceptance.

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
| C. **Neon** managed Postgres | Full. Supports 14-18 (16.15 as of Aug 2026). Region selectable. | Usage-based Free / Launch / Scale plans (check current pricing). PITR history window: Free 6 h, Launch up to 7 days, Scale up to 30 days. Uptime SLA on Scale only. | **Eligible computes (up to 16 CU) on every plan, including Launch, scale to zero after 5 min idle by default** (cold start on the next ledger write); computes above 16 CU remain always active. Free cannot change this; paid plans can disable it per compute. Pooled endpoint is PgBouncer **transaction mode**. |
| D. **Supabase** Postgres | Full Postgres | Free / Pro / Team (check current pricing). Daily backups on Pro (7 days), none on Free. PITR is a separately priced add-on and needs at least the Small compute add-on. | Direct host is IPv6-only unless you buy the IPv4 add-on. The shared Supavisor pooler is IPv4 in both session and transaction mode; prefer session mode, because transaction mode does not support prepared statements. Extra platform surface (auth, storage) we don't need. |
| E. Self-managed Postgres (VPS / container) | Full | Owner runs patching, backups, TLS | Operational load the team hasn't staffed |

Connection notes (from the provider docs):

- Neon's transaction pooler breaks session state: `SET`, session advisory locks, SQL `PREPARE`, `LISTEN`.
- `pg_advisory_xact_lock` is transaction-scoped, so it is compatible in principle. That still has to be proven by running the ledger suites against the pooled endpoint.
- Run migrations on the **direct** endpoint.

## Recommendation

**Option C: Neon Postgres 16, on a paid tier that includes a PITR window (Launch or higher), in a North America region near the host.**

- Keep finance data in its own database, separate from the customer-app SQLite. This keeps single data ownership (ARC-02) and leaves the app's storage migration as a separate decision.
- Use the **direct** endpoint for migrations, and the direct endpoint or a small app-side `pg` pool for the ledger at hackathon volumes. Use the pooled endpoint only after the ledger and pricing suites pass against it.

Supabase (D) is the fallback if the owner already has an account there. From the IPv4 host it needs the Supavisor pooler (session mode preferred) or the IPv4 add-on.

SQLite (A) and MySQL (B) are rejected because they would discard the tested correctness design.

## Consequences

- Finance writes leave the host. Ledger availability now depends on network and Neon uptime. Failing closed when the ledger is unavailable (architecture section 6: stop billable work that cannot be accounted for) is a **design requirement, not shipped behaviour**: `ingestFinancial` in `cost-intelligence` `src/ledger/index.ts` is still a `blockedBoundary` stub ("not available until the accounting leaf is delivered"). The composition must enforce it.
- Two backup domains: Neon PITR for finance, and SQLite `VACUUM INTO` for the app. LIVE-02 must restore both to a consistent point and record it.
- Credentials are a new production secret, stored only in the GoDaddy environment (Preview and Publish). **Use separate Neon branches or databases for Preview and Publish.** They share `/private`, so they must not share a finance database.
- For eligible computes up to 16 CU, scale to zero is on by default on every Neon plan, so the first write after 5 min idle pays a cold start. Computes above 16 CU remain always active. Acceptable for preview and demos, not on a live checkout path: disable it on the production compute (paid plans only; owner action 3).
- The composition (host-injected pool, adapter in getticketstub.com) still has to be built. It is blocked behind CI-05A/B for reservations, but the ledger and pricing stores can be wired first.

## Owner actions

1. **Decide:** Neon (recommended), Supabase, or another option. Also decide the plan tier and region.
2. **Account and terms:** create the provider organization under the company identity and accept its terms of service and data processing addendum yourself. Agents must not do this. Check current pricing and set a spend cap or alert.
3. **Create** project `cost-intelligence`, Postgres **16**, with two databases or branches (`preview`, `production`). Each gets a least-privilege application role (no CREATEDB, no superuser) and a separate migration role. **Do not** add the disposable-database marker. **Disable scale to zero on the `production` compute** (requires a paid plan); decide whether `preview` keeps it.
4. **Secrets:** put the connection strings into GoDaddy Preview and Publish environment variables under a production name such as `FINANCE_DATABASE_URL` (the name is final once the adapter PR fixes it). Never use `CI_TEST_DATABASE_URL` for this, and never paste values into issues or evidence.
5. **Backups:** confirm the PITR window. Approve a restore rehearsal for LIVE-02.
6. **Then:** authorize the adapter and migration PRs (cost-intelligence owners, getticketstub.com composition) and a run of the ledger/pricing suites against a *separate disposable* branch.

## Sources

- Neon connection pooling: https://neon.com/docs/connect/connection-pooling
- Neon plans: https://neon.com/docs/introduction/plans (check current pricing)
- Neon scale to zero (up to 16 CU: 5 min default, fixed on Free, can be disabled on paid plans; above 16 CU always active): https://neon.com/docs/introduction/scale-to-zero
- Neon Postgres versions: https://neon.com/docs/postgresql/postgres-version-policy
- Supabase connecting (shared pooler IPv4 in both modes; no prepared statements in transaction mode): https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase backups (PITR needs at least the Small compute add-on): https://supabase.com/docs/guides/platform/backups (check current pricing)
- GoDaddy Node.js hosting: https://www.godaddy.com/hosting/nodejs (lists managed MySQL; confirm in dashboard)
