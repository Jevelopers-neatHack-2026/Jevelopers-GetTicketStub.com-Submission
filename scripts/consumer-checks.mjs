import { readFile, writeFile, mkdir, mkdtemp, rm, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { hashBytes, hashManifest } from '../tooling/runtime.mjs';
import { contentManifestPath, safePackagePath, verifyPackageContents } from './package-content.mjs';

export const knownConsumers = Object.freeze(['agent-harness', 'event-intelligence', 'creative-engine', 'print-production', 'fulfillment-connectors', 'cost-intelligence', 'team-dashboard', 'integration-evals', 'getticketstub.com']);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const same = (a, b) => hashManifest(a) === hashManifest(b);
const inside = (directory, path) => { const rel = relative(directory, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); };
const root = fileURLToPath(new URL('../', import.meta.url));

export function pinsMatch(entry, schemas, fixtureDigest, packageDigest) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.schema_pins) || entry.schema_pins.some(pin => !pin || typeof pin !== 'object' || typeof pin.contract !== 'string' || typeof pin.version !== 'string' || typeof pin.schema_id !== 'string' || typeof pin.sha256 !== 'string')) return false;
  const acknowledgement = entry.acknowledgement;
  return sha(entry.shared_source_revision) && digest(entry.package_content_digest) && (!packageDigest || entry.package_content_digest === packageDigest) &&
    entry.fixture_digest === fixtureDigest && Array.isArray(entry.schema_pins) && entry.schema_pins.length > 0 &&
    new Set(entry.schema_pins.map(pin => pin.contract + '@' + pin.version)).size === entry.schema_pins.length &&
    entry.schema_pins.every(pin => schemas.some(schema => schema.contract === pin.contract && schema.version === pin.version && schema.schema_id === pin.schema_id && schema.sha256 === pin.sha256)) &&
    ['source', 'artifact'].includes(entry.shared_binding?.mode) && typeof entry.shared_binding.local_path === 'string' &&
    (entry.shared_binding.mode === 'source' || /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.package_integrity ?? '')) &&
    acknowledgement?.status === 'accepted' && acknowledgement.consumer_sha === entry.source_sha &&
    acknowledgement.shared_source_revision === entry.shared_source_revision && acknowledgement.fixture_digest === fixtureDigest &&
    acknowledgement.package_content_digest === entry.package_content_digest && acknowledgement.schema_pins_digest === hashManifest(entry.schema_pins) &&
    acknowledgement.command_digest === hashManifest(entry.command ?? null) && acknowledgement.package_integrity === (entry.package_integrity ?? null) &&
    typeof acknowledgement.record_ref === 'string' && /^https:\/\/github\.com\//.test(acknowledgement.record_ref) &&
    typeof acknowledgement.reviewer === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(acknowledgement.reviewer) &&
    typeof acknowledgement.reviewed_at === 'string' && Number.isFinite(Date.parse(acknowledgement.reviewed_at));
}

/** Only ordinary npm archive files are accepted; links, traversal, duplicates and oversized entries fail. */
export function readPackageArchive(bytes, integrity) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 32 * 1024 * 1024 || 'sha512-' + createHash('sha512').update(bytes).digest('base64') !== integrity) throw new Error('ARTIFACT_INTEGRITY_MISMATCH');
  const tar = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 });
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const string = (start, length) => header.subarray(start, start + length).toString('utf8').split('\0')[0];
    const name = string(0, 100), prefix = string(345, 155), path = (prefix ? prefix + '/' : '') + name;
    const checksumText = string(148, 8).trim();
    const sizeText = string(124, 12).trim();
    if (!/^[0-7]+$/.test(checksumText) || !/^[0-7]+$/.test(sizeText)) throw new Error('INVALID_PACKAGE_ARCHIVE');
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    const size = Number.parseInt(sizeText, 8);
    if (checksum !== Number.parseInt(checksumText, 8) || size > 16 * 1024 * 1024 || offset + 512 + size > tar.length) throw new Error('INVALID_PACKAGE_ARCHIVE');
    const type = string(156, 1), local = path.slice('package/'.length);
    if (!path.startsWith('package/') || !safePackagePath(local) || !['', '0'].includes(type) || files.has(local)) throw new Error('INVALID_PACKAGE_ARCHIVE');
    files.set(local, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!files.size || offset + 1024 > tar.length || !tar.subarray(offset, offset + 1024).every(byte => byte === 0)) throw new Error('INVALID_PACKAGE_ARCHIVE');
  return files;
}

async function checkoutCode(path, expected, shared = false) {
  const revision = spawnSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (revision.status !== 0 || revision.stdout.trim() !== expected) return shared ? 'BLOCKED_SHARED_REVISION_MISMATCH' : 'BLOCKED_REVISION_MISMATCH';
  const dirty = spawnSync('git', ['-C', path, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
  if (dirty.status !== 0 || dirty.stdout.trim()) return shared ? 'BLOCKED_DIRTY_SHARED_CHECKOUT' : 'BLOCKED_DIRTY_CHECKOUT';
  return null;
}

async function bindPackage(entry, expected, directory) {
  let files;
  if (entry.shared_binding.mode === 'source') {
    const code = await checkoutCode(entry.shared_binding.local_path, entry.shared_source_revision, true);
    if (code) throw new Error(code);
    const checkout = await realpath(entry.shared_binding.local_path);
    if (!await verifyPackageContents(checkout, expected)) throw new Error('PACKAGE_CONTENT_MISMATCH');
    files = new Map();
    for (const path of [...Object.keys(expected.files), contentManifestPath]) {
      const actual = await realpath(join(checkout, path));
      if (!inside(checkout, actual)) throw new Error('INVALID_PACKAGE_PATH');
      files.set(path, await readFile(actual));
    }
  } else {
    files = readPackageArchive(await readFile(entry.shared_binding.local_path), entry.package_integrity);
    const names = [...Object.keys(expected.files), contentManifestPath].sort();
    if (!same([...files.keys()].sort(), names)) throw new Error('PACKAGE_CONTENT_MISMATCH');
  }
  for (const [path, bytes] of files) {
    if (!safePackagePath(path) || (path !== contentManifestPath && hashBytes(bytes) !== expected.files[path])) throw new Error('PACKAGE_CONTENT_MISMATCH');
    const target = join(directory, path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, bytes, { mode: 0o444 });
  }
  if (!await verifyPackageContents(directory, expected)) throw new Error('PACKAGE_CONTENT_MISMATCH');
}

export async function consumerChecks(manifest, paths = {}) {
  const failures = [], records = [], checkout_records = [];
  const readJson = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
  const schemaManifest = await readJson('generated/schema-manifest.json');
  const fixtureManifest = await readJson('generated/fixture-manifest.json');
  const expectedPackage = await readJson(contentManifestPath);
  if (!await verifyPackageContents(root, expectedPackage)) return { failures: [{ code: 'STALE_PACKAGE_CONTENT' }], records, checkout_records };
  if (hashManifest(fixtureManifest.files) !== fixtureManifest.digest) return { failures: [{ code: 'INVALID_FIXTURE_DIGEST' }], records, checkout_records };
  for (const [path, expected] of Object.entries(fixtureManifest.files)) if (hashBytes(await readFile(join(root, path))) !== expected) return { failures: [{ code: 'STALE_FIXTURE_DIGEST' }], records, checkout_records };
  for (const schema of schemaManifest.schemas) if (hashBytes(await readFile(join(root, schema.path))) !== 'sha256:' + schema.sha256) return { failures: [{ code: 'STALE_SCHEMA_DIGEST' }], records, checkout_records };
  if (!Array.isArray(manifest.repositories)) return { failures: [{ code: 'INVALID_CONSUMER_MANIFEST' }], records, checkout_records };
  for (const row of manifest.repositories) if (!knownConsumers.includes(row.repository)) failures.push({ code: 'UNKNOWN_CONSUMER', repository: 'unknown' });
  const catalogText = await readFile(join(root, 'docs/contract-catalog.md'), 'utf8');
  const catalog = JSON.parse(catalogText.match(/\x60\x60\x60json catalog\n([\s\S]*?)\n\x60\x60\x60/)[1]).contracts;
  for (const repository of knownConsumers) {
    const entries = manifest.repositories.filter(entry => entry.repository === repository);
    const block = code => failures.push({ code, repository });
    if (entries.length !== 1) { block('MISSING_OR_DUPLICATE_CONSUMER'); continue; }
    const local = paths[repository];
    const entry = structuredClone(entries[0]);
    const path = typeof local === 'string' ? local : local?.checkout ?? entry.local_path;
    if (local && typeof local === 'object') {
      if (entry.shared_binding && local.shared) entry.shared_binding.local_path = local.shared;
      if (entry.acknowledgement && local.acknowledgement) entry.acknowledgement.local_path = local.acknowledgement;
    }
    if (!sha(entry.source_sha)) { block('INVALID_SOURCE_PIN'); continue; }
    if (!path) { block('BLOCKED_MISSING_CHECKOUT'); continue; }
    const code = await checkoutCode(path, entry.source_sha);
    if (code) { block(code); continue; }
    checkout_records.push({ repository, source_sha: entry.source_sha, checkout: 'clean_exact_revision' });
    if (!pinsMatch(entry, schemaManifest.schemas, fixtureManifest.digest, expectedPackage.digest) || entry.dependency_mode !== 'offline') { block('BLOCKED_MISSING_INTEGRATION_PIN'); continue; }
    const required = catalog.filter(contract => contract.producers.includes(repository) || contract.consumers.includes(repository));
    const requiredNames = required.map(contract => contract.name);
    if (required.some(contract => !entry.schema_pins.some(pin => pin.contract === contract.name && pin.version === contract.schema_version)) || !Array.isArray(entry.roles) || required.some(contract => !entry.roles.some(role => role && role.contract === contract.name && role.producer === contract.producers.includes(repository) && role.consumer === contract.consumers.includes(repository)))) { block('BLOCKED_INCOMPLETE_CONSUMER_COVERAGE'); continue; }
    if (!Array.isArray(entry.command) || entry.command.length !== 2 || entry.command[0] !== 'node' || typeof entry.command[1] !== 'string' || !safePackagePath(entry.command[1]) || !entry.command[1].endsWith('.mjs')) { block('BLOCKED_MISSING_CONSUMER_COMMAND'); continue; }
    let temp;
    try {
      const checkout = await realpath(path), script = await realpath(resolve(checkout, entry.command[1]));
      if (!inside(checkout, script)) { block('INVALID_CONSUMER_COMMAND'); continue; }
      if (typeof entry.acknowledgement.local_path !== 'string') { block('BLOCKED_MISSING_ACKNOWLEDGEMENT_RECORD'); continue; }
      const acknowledgement = JSON.parse(await readFile(entry.acknowledgement.local_path, 'utf8'));
      const declared = Object.fromEntries(Object.entries(entry.acknowledgement).filter(([key]) => key !== 'local_path'));
      if (!same(acknowledgement, declared)) { block('INVALID_ACKNOWLEDGEMENT_RECORD'); continue; }
      temp = await mkdtemp(join(tmpdir(), 'shared-contracts-pin-'));
      const snapshot = join(temp, 'package');
      await bindPackage(entry, expectedPackage, snapshot);
      const nonce = randomUUID(), audit = join(temp, 'audit.jsonl'), config = join(temp, 'binding.json');
      const binding = { repository, consumer_sha: entry.source_sha, shared_source_revision: entry.shared_source_revision, package_integrity: entry.package_integrity ?? null, package_content_digest: expectedPackage.digest, fixture_digest: fixtureManifest.digest, nonce };
      await writeFile(config, JSON.stringify({ snapshot, audit, binding, required: requiredNames, files: expectedPackage.files }));
      const result = spawnSync(process.execPath, ['--import', join(root, 'scripts/consumer-import-hook.mjs'), script], { cwd: checkout, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, SHARED_CONTRACTS_ROOT: snapshot, SHARED_CONTRACTS_OFFLINE: '1', SHARED_CONTRACTS_BINDING_CONFIG: config } });
      if (result.status !== 0) { block('CONSUMER_CHECK_FAILED'); continue; }
      let receipt;
      try { receipt = JSON.parse(result.stdout); } catch (error) { if (!(error instanceof SyntaxError)) throw error; block('MISSING_CONSUMER_RECEIPT'); continue; }
      const observed = (await readFile(audit, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const coverage = observed.filter(row => row.kind === 'fixture_run' && row.bound && row.failures === 0);
      if (requiredNames.some(name => !coverage.some(row => row.contract === name && row.positive > 0 && row.negative > 0 && row.semantic === (name === 'CommonEnvelope' || name === 'EvidenceProjection' ? 0 : 1)))) { block('MISSING_OBSERVED_PACKAGE_COVERAGE'); continue; }
      if (receipt.status !== 'passed' || receipt.consumer_sha !== binding.consumer_sha || receipt.shared_source_revision !== binding.shared_source_revision || receipt.fixture_digest !== binding.fixture_digest || receipt.package_content_digest !== binding.package_content_digest || receipt.package_integrity !== binding.package_integrity || receipt.binding_nonce !== nonce || !Array.isArray(receipt.contracts_tested) || !same([...receipt.contracts_tested].sort(), [...requiredNames].sort())) { block('INVALID_CONSUMER_RECEIPT'); continue; }
      if (!await verifyPackageContents(snapshot, expectedPackage) || !await verifyPackageContents(root, expectedPackage)) { block('PACKAGE_CHANGED_DURING_DRIVER'); continue; }
      const changed = await checkoutCode(checkout, entry.source_sha);
      if (changed) { block(changed); continue; }
      records.push({ repository, source_sha: entry.source_sha, shared_source_revision: binding.shared_source_revision, package_content_digest: binding.package_content_digest, package_integrity: binding.package_integrity, fixture_digest: binding.fixture_digest, schema_pins: entry.schema_pins, status: 'passed', command: entry.command, observed_contracts: [...new Set(coverage.map(row => row.contract))].sort(), acknowledgement_provenance: { reviewer: acknowledgement.reviewer, record_ref: acknowledgement.record_ref, reviewed_at: acknowledgement.reviewed_at }, authority_authenticity: 'external_owner_review_required' });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const codes = ['BLOCKED_SHARED_REVISION_MISMATCH', 'BLOCKED_DIRTY_SHARED_CHECKOUT', 'ARTIFACT_INTEGRITY_MISMATCH', 'INVALID_PACKAGE_ARCHIVE', 'PACKAGE_CONTENT_MISMATCH', 'INVALID_PACKAGE_PATH'];
      block(codes.includes(error.message) ? error.message : error.code === 'ENOENT' ? 'BLOCKED_MISSING_LOCAL_ARTIFACT' : 'INVALID_LOCAL_INTEGRATION_ARTIFACT');
    } finally { if (temp) await rm(temp, { recursive: true, force: true }); }
  }
  return { failures, records, checkout_records };
}
