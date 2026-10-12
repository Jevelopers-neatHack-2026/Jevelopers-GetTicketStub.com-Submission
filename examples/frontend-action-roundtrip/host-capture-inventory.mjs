/** Strict inventory of certified MOCK captures and preserved incomplete attempts. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, readlinkSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
export const attemptFormat = 'controls-fixture-capture-attempt/1';
export function inventoryTree(root, prefix = '') {
  const entries = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name), relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { entries.push({ path: relative, kind: 'directory' }); entries.push(...inventoryTree(path, relative)); }
    else if (entry.isFile() || entry.isSymbolicLink()) {
      const bytes = entry.isFile() ? readFileSync(path) : readlinkSync(path, { encoding: 'buffer' });
      entries.push({ path: relative, kind: entry.isFile() ? 'file' : 'symlink', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    } else entries.push({ path: relative, kind: 'special', mode: lstatSync(path).mode });
  }
  return entries;
}
export function regularFileManifest(root) {
  return inventoryTree(root).filter(entry => entry.kind !== 'directory').map(({ kind, ...entry }) => {
    assert.equal(kind, 'file', 'Certified captures must contain regular files only'); return entry;
  });
}
export function readCertifiedCapture(root) {
  const children = readdirSync(root).sort();
  assert.deepEqual(children, ['manifest.json', 'receipt.json', 'store-root'], 'Unexpected certified capture member');
  assert.equal(lstatSync(join(root, 'store-root')).isDirectory(), true);
  for (const name of ['manifest.json', 'receipt.json']) assert.equal(lstatSync(join(root, name)).isFile(), true);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'))), receipt = JSON.parse(readFileSync(join(root, 'receipt.json')));
  const tree = inventoryTree(join(root, 'store-root'));
  assert.deepEqual(regularFileManifest(join(root, 'store-root')), manifest, 'Certified manifest membership and bytes must match');
  const parentPaths = manifest.flatMap(file => file.path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/')));
  // The fixture's object-store constructor retains its empty staging root.
  const directories = [...new Set([...parentPaths, ...(parentPaths.includes('objects') ? ['objects/staging'] : [])])].sort();
  assert.deepEqual(tree.filter(entry => entry.kind === 'directory').map(entry => entry.path).sort(), directories, 'Unexpected certified store directory');
  assert.equal(receipt.files, manifest.length); assert.equal(receipt.mode, 'mock'); assert.equal(receipt.live_calls, 0);
  return { root, receipt, manifest };
}
export function readCaptureInventory(evidence) {
  const sessions = [], attempts = [];
  for (const entry of readdirSync(evidence, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    assert.equal(entry.isDirectory(), true, 'Unexpected capture evidence member');
    if (entry.name === 'attempts') continue;
    assert.match(entry.name, /^session-\d{4,}-[A-Za-z0-9]+$/, 'Unexpected capture evidence directory');
    sessions.push({ name: entry.name, ...readCertifiedCapture(join(evidence, entry.name)) });
  }
  const names = readdirSync(join(evidence, 'attempts'), { withFileTypes: true }), expected = new Set();
  for (const entry of names.filter(entry => entry.name.endsWith('.json'))) {
    assert.equal(entry.isFile(), true, 'Attempt records must be regular files');
    assert.match(entry.name, /^attempt-\d{4,}-[A-Za-z0-9]+\.json$/, 'Unexpected attempt record');
    const record = JSON.parse(readFileSync(join(evidence, 'attempts', entry.name)));
    assert.deepEqual(Object.keys(record).sort(), ['attempt', 'cwd', 'files', 'format', 'fragments', 'live_calls', 'mode', 'node', 'node_executable', 'reason', 'record_failures', 'stage', 'started_at', 'status'].sort());
    assert.equal(record.format, attemptFormat); assert.equal(record.status, 'incomplete'); assert.equal(record.mode, 'mock'); assert.equal(record.live_calls, 0);
    assert.equal(entry.name, `${record.attempt}.json`); assert.match(record.attempt, /^attempt-\d{4,}-[A-Za-z0-9]+$/);
    assert.ok(['copy', 'walk', 'manifest', 'receipt', 'publish'].includes(record.stage));
    for (const key of ['cwd', 'node', 'node_executable', 'reason', 'started_at']) assert.equal(typeof record[key], 'string');
    assert.equal(Number.isSafeInteger(record.record_failures) && record.record_failures >= 0, true);
    assert.equal(lstatSync(join(evidence, 'attempts', record.attempt)).isDirectory(), true);
    assert.deepEqual(inventoryTree(join(evidence, 'attempts', record.attempt)), record.files, 'Incomplete attempt membership and bytes must match');
    expected.add(entry.name); expected.add(record.attempt);
    assert.ok(Array.isArray(record.fragments)); assert.ok(record.fragments.length <= record.record_failures);
    for (const fragment of record.fragments) {
      assert.match(fragment.name, new RegExp(`^${record.attempt}\\.record-[a-f0-9-]+$`));
      assert.equal(expected.has(fragment.name), false, 'Duplicate attempt record fragment'); expected.add(fragment.name);
      assert.equal(lstatSync(join(evidence, 'attempts', fragment.name)).isFile(), true);
      const bytes = readFileSync(join(evidence, 'attempts', fragment.name));
      assert.deepEqual(fragment, { name: fragment.name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    attempts.push(record);
  }
  assert.deepEqual(names.map(entry => entry.name).sort(), [...expected].sort(), 'Every incomplete attempt and record fragment must be inventoried');
  return { sessions, attempts };
}
