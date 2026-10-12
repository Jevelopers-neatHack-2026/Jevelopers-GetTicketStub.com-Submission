#!/usr/bin/env node
// Runs the producer's own `consumerChecks` against this repository's driver, from a TEMP COPY of the read-only producer
// checkout (never modify the original). Usage:
//   node scripts/producer-consumer-check.mjs <producer-copy-dir> <archive.tgz> [consumer-sha]
// The acknowledgement it fabricates is SYNTHETIC and only satisfies the runner's machine-consistency gate. It is not an
// owner acknowledgement, names no reviewer and must never be committed or quoted as one.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const [copyArg, archiveArg, shaArg] = process.argv.slice(2);
if (!copyArg || !archiveArg) { console.error('usage: producer-consumer-check.mjs <producer-copy-dir> <archive.tgz> [consumer-sha]'); process.exit(2); }
const copy = resolve(copyArg), archive = resolve(archiveArg);
const sha = shaArg ?? execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const pin = JSON.parse(readFileSync(join(root, 'contracts/shared-contracts.pin.json'), 'utf8'));
const load = (path) => import(pathToFileURL(join(copy, path)).href);
const readJson = (path) => JSON.parse(readFileSync(join(copy, path), 'utf8'));
const { consumerChecks } = await load('scripts/consumer-checks.mjs');
const { hashManifest } = await load('tooling/runtime.mjs');
const manifest = readJson('compatibility/consumers.json');
const schemas = readJson('generated/schema-manifest.json').schemas, fixtures = readJson('generated/fixture-manifest.json'), content = readJson('generated/package-content-manifest.json');
if (fixtures.digest !== pin.fixture_digest || content.digest !== pin.package_content_digest) { console.error('producer copy does not match the pin'); process.exit(1); }
const row = manifest.repositories.find((entry) => entry.repository === 'team-dashboard');
Object.assign(row, { source_sha: sha, shared_source_revision: pin.head, package_integrity: pin.package_integrity, package_content_digest: content.digest, fixture_digest: fixtures.digest,
  command: ['node', 'contracts/contract-driver.mjs'], dependency_mode: 'offline', shared_binding: { mode: 'artifact', local_path: null } });
row.schema_pins = row.roles.map((role) => { const s = schemas.find((x) => x.contract === role.contract); return { contract: s.contract, version: s.version, schema_id: s.schema_id, sha256: s.sha256 }; });
const ack = { status: 'accepted', consumer_sha: sha, shared_source_revision: pin.head, package_content_digest: content.digest, fixture_digest: fixtures.digest, schema_pins_digest: hashManifest(row.schema_pins),
  command_digest: hashManifest(row.command), package_integrity: pin.package_integrity, reviewer: 'SYNTHETIC-local-run-NOT-an-owner-acknowledgement', reviewed_at: new Date().toISOString(),
  record_ref: 'https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/5#SYNTHETIC-local-machine-consistency-only' };
const directory = mkdtempSync(join(tmpdir(), 'td01b-synthetic-ack-'));
try {
  const ackPath = join(directory, 'synthetic-ack.json');
  writeFileSync(ackPath, JSON.stringify(ack));
  row.acknowledgement = { ...ack, local_path: ackPath };
  const result = await consumerChecks(manifest, { 'team-dashboard': { checkout: root, shared: archive, acknowledgement: ackPath } });
  const mine = result.records.filter((r) => r.repository === 'team-dashboard');
  const failures = result.failures.filter((f) => f.repository === 'team-dashboard');
  console.log(JSON.stringify({ synthetic_acknowledgement: true, owner_acknowledgement: null, team_dashboard_failures: failures, other_repository_rows_blocked: result.failures.filter((f) => f.repository !== 'team-dashboard').length,
    records: mine.map((r) => ({ source_sha: r.source_sha, status: r.status, observed_contracts: r.observed_contracts, trusted_fixture_cases: r.trusted_fixture_verification.reduce((n, x) => n + x.cases, 0), package_modules_imported: r.import_observations.length, execution_evidence: r.execution_evidence })) }, null, 1));
  if (failures.length || mine.length !== 1) process.exitCode = 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
