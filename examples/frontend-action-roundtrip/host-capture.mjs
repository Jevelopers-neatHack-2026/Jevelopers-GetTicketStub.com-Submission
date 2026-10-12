/** Exact custody of a quiescent MOCK host; failed close/copy never certifies it. */
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readdirSync, readFileSync, renameSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { attemptFormat, inventoryTree, readCertifiedCapture } from './host-capture-inventory.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { join, basename } from 'node:path';
let captureSequence = 0;
function persistAttempt(attempt, io) {
  const files = inventoryTree(attempt.path);
  if (attempt.record.files === undefined) attempt.record.files = files;
  else assert.deepEqual(files, attempt.record.files, 'Owned incomplete capture changed before inventory publication');
  for (const fragment of attempt.record.fragments) {
    const bytes = io.read(join(attempt.root, fragment.name));
    const measured = { name: fragment.name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    if (fragment.bytes === undefined) Object.assign(fragment, measured);
    else assert.deepEqual(fragment, measured);
  }
  const fragment = `${attempt.record.attempt}.record-${randomUUID()}`, temporary = join(attempt.root, fragment), target = join(attempt.root, `${attempt.record.attempt}.json`);
  try {
    if (existsSync(target)) throw new Error('Attempt inventory target already exists');
    io.write(temporary, JSON.stringify(attempt.record, null, 2) + '\n', { flag: 'wx' });
    io.rename(temporary, target);
  } catch (error) {
    attempt.record.record_failures++;
    // Own the path before reading it: even a failed read must block publication.
    if (existsSync(temporary)) {
      const owned = { name: fragment }; attempt.record.fragments.push(owned);
      try {
        const bytes = io.read(temporary);
        Object.assign(owned, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      } catch (readError) { throw new AggregateError([error, readError], 'Incomplete-attempt record write and fragment measurement failed'); }
    }
    throw error;
  }
}
export function closeAndCaptureHost(session, reason, evidence = process.env.CONTROLS_BROWSER_EVIDENCE_DIR, operations = {}) {
  const io = { copy: cpSync, read: readFileSync, write: writeFileSync, rename: renameSync, ...operations };
  session.pendingCaptures ??= [];
  while (session.pendingCaptures.length) { persistAttempt(session.pendingCaptures[0], io); session.pendingCaptures.shift(); }
  if (session.finalized) return;
  const { host, dir } = session;
  if (!session.closed) { session.counters ??= host.counts(); host.close(); session.closed = true; }
  const counters = session.counters;
  if (!evidence) { session.finalized = true; return; }
  const attempts = join(evidence, 'attempts'); mkdirSync(attempts, { recursive: true });
  const target = mkdtempSync(join(attempts, `attempt-${String(++captureSequence).padStart(4,'0')}-`)), started_at = new Date().toISOString();
  let stage = 'copy';
  try {
    io.copy(dir, join(target, 'store-root'), { recursive: true });
    const files = [];
    function walk(directory, prefix = '') {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
        const path = join(directory, entry.name), relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new TypeError('Browser fixture store must not contain links');
        if (entry.isDirectory()) walk(path, relative);
        else { if (!entry.isFile()) throw new TypeError('Browser fixture store must contain regular files'); const bytes = io.read(path); files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
      }
    }
    stage = 'walk'; walk(join(target, 'store-root'));
    stage = 'manifest'; io.write(join(target, 'manifest.json'), JSON.stringify(files, null, 2) + '\n');
    stage = 'receipt'; io.write(join(target, 'receipt.json'), JSON.stringify({ reason, captured_at: new Date().toISOString(), node: process.version, node_executable: process.execPath,
      cwd: process.cwd(), mode: 'mock', live_calls: 0, counters, membership: 'explicit MOCK fixture', files: files.length }, null, 2) + '\n');
    stage = 'publish';
    readCertifiedCapture(target);
    const published = join(evidence, basename(target).replace(/^attempt-/, 'session-'));
    if (existsSync(published)) throw new Error('Capture publication target already exists');
    io.rename(target, published); session.finalized = true;
  } catch (error) {
    const attempt = { root: attempts, path: target, record: { format: attemptFormat, status: 'incomplete', attempt: basename(target), stage, reason, started_at, node: process.version, node_executable: process.execPath, cwd: process.cwd(), mode: 'mock', live_calls: 0, files: undefined, record_failures: 0, fragments: [] } };
    session.pendingCaptures.push(attempt);
    try { persistAttempt(attempt, io); session.pendingCaptures.shift(); }
    catch (inventoryError) { throw new AggregateError([error, inventoryError], 'MOCK capture and incomplete-attempt inventory failed'); }
    throw error;
  }
}
