import "server-only";
import type { DatabaseSync } from "node:sqlite";

// Forward-only migrations for the Prodigi callback tables, in the same style as src/server/migrations.ts, but with
// their own version row in `module_schema` instead of PRAGMA user_version. The app's main list is positional and
// several open branches append to it; keeping this module's chain separate means neither renumbers the other.
// They live in the app database (TICKETSTUB_DB), so the existing backup and restore tooling copies them.
// Never edit one that has shipped; add a new entry.
//
// Nothing stored here is personal: Prodigi order and event IDs, stages, step states, shipment IDs, times and
// counts. The callback body, the recipient, tracking numbers and tokens are never written.
export const PRODIGI_SCHEMA_MODULE = "prodigi-callbacks";

const MIGRATIONS: string[] = [
  `
  -- Authoritative order state per scope (ProdigiReconciledOrderState as JSON). Written only by compare-and-set on
  -- revision, and only after trackOrder or an authenticated read. A row exists only for an order we created.
  CREATE TABLE prodigi_orders (
    tenant_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, project_id, order_id)
  );

  -- Replay records: callback event IDs a covering read has reconciled. Dropped at expires_at; capped, oldest
  -- (lowest seq) first. Eviction only costs a read.
  CREATE TABLE prodigi_callback_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    UNIQUE (tenant_id, project_id, order_id, event_id)
  );
  CREATE INDEX prodigi_callback_events_expiry ON prodigi_callback_events (expires_at);

  -- At most one pending reconciliation per order (ProdigiPendingReconciliation as JSON), compare-and-set on
  -- revision. stale_at is copied out of the record so the per-scope live count is one indexed query.
  CREATE TABLE prodigi_pending (
    tenant_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    stale_at INTEGER NOT NULL,
    record TEXT NOT NULL,
    PRIMARY KEY (tenant_id, project_id, order_id),
    FOREIGN KEY (tenant_id, project_id, order_id) REFERENCES prodigi_orders (tenant_id, project_id, order_id) ON DELETE CASCADE
  );
  CREATE INDEX prodigi_pending_live ON prodigi_pending (tenant_id, project_id, stale_at);

  -- Durable job queue for the in-process worker. kind: reconcile (a ProdigiReconcileJob from the reconciler's
  -- scheduler), poll (reconcileOrder for an abandoned chain) or track (a trackOrder that failed right after an
  -- order was created). due_at honours the job's delayMs. A worker leases a row (lease_owner, lease_until); a
  -- lease that runs out (crash, restart) makes the row claimable again. A row is deleted only when its run returns.
  CREATE TABLE prodigi_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('reconcile', 'poll', 'track')),
    order_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    due_at INTEGER NOT NULL,
    lease_owner TEXT,
    lease_until INTEGER,
    runs INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX prodigi_jobs_due ON prodigi_jobs (due_at, id);

  -- reconcile_abandoned alerts, one per dedupe_key (orderId|firstReceivedAt|coverAfter). Inserting one also queues
  -- a poll job in the same transaction; poll_status records what that poll found, for the operator.
  CREATE TABLE prodigi_alerts (
    dedupe_key TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    error_code TEXT,
    attempts INTEGER NOT NULL,
    required_stage TEXT,
    cover_after TEXT NOT NULL,
    first_received_at TEXT NOT NULL,
    abandoned_at TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    poll_status TEXT NOT NULL DEFAULT 'queued',
    polled_at INTEGER,
    poll_error TEXT
  );
  CREATE INDEX prodigi_alerts_created ON prodigi_alerts (created_at);
  `,
];

export function migrateProdigi(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS module_schema (module TEXT PRIMARY KEY, version INTEGER NOT NULL)");
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT version FROM module_schema WHERE module = ?").get(PRODIGI_SCHEMA_MODULE) as { version: number } | undefined;
    for (let v = row?.version ?? 0; v < MIGRATIONS.length; v++) {
      db.exec(MIGRATIONS[v]);
      db.prepare("INSERT INTO module_schema (module, version) VALUES (?, ?) ON CONFLICT (module) DO UPDATE SET version = excluded.version").run(PRODIGI_SCHEMA_MODULE, v + 1);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
