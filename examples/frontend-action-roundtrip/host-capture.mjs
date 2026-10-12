/** Exact custody of a quiescent MOCK host; failed close/copy never certifies it. */
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
let captureSequence = 0;
export function closeAndCaptureHost(session, reason, evidence = process.env.CONTROLS_BROWSER_EVIDENCE_DIR) {
  const { host, dir } = session;
  if (!session.closed) { session.counters ??= host.counts(); host.close(); session.closed = true; }
  const counters = session.counters;
  if (!evidence) { session.finalized = true; return; }
  mkdirSync(evidence, { recursive: true });
  const target = mkdtempSync(join(evidence, `session-${String(++captureSequence).padStart(4,'0')}-`)); cpSync(dir, join(target, 'store-root'), { recursive: true });
  const files = [];
  function walk(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name), relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new TypeError('Browser fixture store must not contain links');
      if (entry.isDirectory()) walk(path, relative);
      else { const bytes = readFileSync(path); files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
    }
  }
  walk(join(target, 'store-root'));
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(files, null, 2) + '\n');
  writeFileSync(join(target, 'receipt.json'), JSON.stringify({ reason, captured_at: new Date().toISOString(), node: process.version, node_executable: process.execPath,
    cwd: process.cwd(), mode: 'mock', live_calls: 0, counters, membership: 'explicit MOCK fixture', files: files.length }, null, 2) + '\n');
  session.finalized = true;
}
