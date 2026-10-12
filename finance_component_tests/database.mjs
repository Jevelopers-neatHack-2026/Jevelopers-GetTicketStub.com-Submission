import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function prepareDatabase(source, pin, config) {
  const { default: pg } = await import(pathToFileURL(join(source, 'node_modules/pg/lib/index.js')));
  const { DISPOSABLE_MARKER, assertDisposableMarker } = await import(pathToFileURL(join(source, 'scripts/test-db-lifecycle.mjs')));
  const receipt = { migrations: [], roles: [], markerValidated: false, rolesCleaned: false };
  const secrets = [];
  let client;
  for (let attempt = 0; attempt < 30; attempt++) {
    client = new pg.Client(config);
    try { await client.connect(); break; }
    catch (error) {
      await client.end();
      if (attempt === 29) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  const environment = {};
  const created = [];
  const register = (prefix, connection) => {
    for (const [key, field] of [['HOST', 'host'], ['PORT', 'port'], ['USER', 'user'], ['PASSWORD', 'password'], ['NAME', 'database']]) {
      environment[`${prefix}_${key}`] = String(connection[field]);
    }
  };
  register('CI_TEST_DB', config);
  async function cleanup() {
    try {
      for (const role of created.reverse()) {
        await client.query(`REVOKE ${role.group} FROM "${role.name}"`);
        await client.query(`DROP ROLE "${role.name}"`);
      }
      receipt.rolesCleaned = true;
    } finally { await client.end(); }
  }
  async function initialize() {
    receipt.server = (await client.query('SHOW server_version')).rows[0].server_version;
    assert.match(receipt.server, /^16\./);
    await client.query('CREATE SCHEMA ci_test');
    await client.query('CREATE TABLE ci_test.disposable_database_marker (marker text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())');
    await client.query('INSERT INTO ci_test.disposable_database_marker(marker) VALUES ($1)', [DISPOSABLE_MARKER]);
    assertDisposableMarker((await client.query('SELECT marker FROM ci_test.disposable_database_marker')).rows);
    receipt.markerValidated = true;
    await client.query('CREATE SCHEMA cost_intelligence');
    await client.query('CREATE TABLE cost_intelligence.schema_migrations (version text PRIMARY KEY, checksum_sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const migration of pin.migrations) {
      const sql = await readFile(join(source, 'migrations', migration.name), 'utf8');
      assert.equal(createHash('sha256').update(sql).digest('hex'), migration.sha256);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO cost_intelligence.schema_migrations(version,checksum_sha256) VALUES ($1,$2)', [migration.name.replace(/\.sql$/, ''), migration.sha256]);
        await client.query('COMMIT');
        receipt.migrations.push({ ...migration, applied: true });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    for (const kind of ['runtime', 'migrator']) {
      const name = `ci_${kind}_${randomBytes(6).toString('hex')}`;
      const password = randomBytes(32).toString('base64url');
      secrets.push(password);
      const group = `ci_finance_${kind}`;
      await client.query(`CREATE ROLE "${name}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS`);
      created.push({ name, group });
      await client.query(`GRANT ${group} TO "${name}"`);
      register(`CI_TEST_DB_${kind.toUpperCase()}`, { ...config, user: name, password });
      const role = (await client.query('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolcanlogin,pg_has_role($1::name,$2::name,\'MEMBER\') AS member FROM pg_roles WHERE rolname=$1', [name, group])).rows[0];
      assert.deepEqual(role, { rolname: name, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true, member: true });
      const restricted = new pg.Client({ ...config, user: name, password });
      await restricted.connect();
      let identity;
      try { identity = (await restricted.query('SELECT current_user,session_user')).rows[0]; }
      finally { await restricted.end(); }
      assert.deepEqual(identity, { current_user: name, session_user: name });
      const ownership = (await client.query("SELECT bool_and(pg_get_userbyid(relowner)<>$1) AS non_owner FROM pg_class WHERE relnamespace='cost_intelligence'::regnamespace", [name])).rows[0];
      assert.equal(ownership.non_owner, true);
      receipt.roles.push({ kind, group, ...role, ...identity, ...ownership });
    }
    receipt.installedMigrations = (await client.query('SELECT version,checksum_sha256 FROM cost_intelligence.schema_migrations ORDER BY version')).rows;
  }
  return { environment, receipt, secrets, cleanup, initialize };
}
