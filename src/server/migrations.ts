import "server-only";
import type { DatabaseSync } from "node:sqlite";

// Forward-only migrations, applied in order. PRAGMA user_version records how many have run.
// Never edit one that has shipped; add a new entry.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    wall_token TEXT UNIQUE,
    wall_public INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE login_links (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    return_to TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE INDEX login_links_expires ON login_links (expires_at);

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_account ON sessions (account_id);

  -- One row per stub per account. A tombstone keeps the row with deleted = 1 and updated_at = when it was deleted.
  CREATE TABLE wall_stubs (
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    stub_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    PRIMARY KEY (account_id, stub_id)
  );

  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    account_id TEXT REFERENCES accounts (id) ON DELETE SET NULL,
    email TEXT,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX orders_account ON orders (account_id, created_at);
  CREATE INDEX orders_email ON orders (email);

  -- owner_key is an account id, or "anon" for a share made while signed out.
  CREATE TABLE shares (
    token TEXT PRIMARY KEY,
    owner_key TEXT NOT NULL,
    stub_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (owner_key, stub_id)
  );

  CREATE TABLE organizer_events (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    stub TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE claims (
    token_hash TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES organizer_events (id) ON DELETE CASCADE,
    guest_name TEXT NOT NULL,
    seat TEXT,
    claimed_by TEXT REFERENCES accounts (id) ON DELETE SET NULL,
    claimed_stub_id TEXT,
    claimed_at INTEGER
  );
  CREATE INDEX claims_event ON claims (event_id);
  `,
  `
  ALTER TABLE login_links ADD COLUMN account_id TEXT;
  `,
  `
  ALTER TABLE login_links ADD COLUMN share_token TEXT;
  `,
  `
  -- Daily art generations per key ("acc:<id>", "dev:<id>", "ip:<ip>"); day is the UTC date.
  CREATE TABLE art_usage (
    key TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (key, day)
  );
  `,
];

export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
