import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

/**
 * Copies the Finance export producer's immutable candidate receipts into this repository, verifying every byte against the handoff pins. Run it once against the producer packet:
 *
 *   node scripts/prepare-export-conformance.mjs <export-producer-handoff-0c4 directory>
 *
 * The packet directory must contain `export-producer-handoff.json` (sha256 410a99fe...), `candidate-postgres-composition.json` (sha256 6d1995a0...) and, optionally, the raw
 * `candidate-artifacts/receipt-NN/` files. Nothing is executed or imported from the packet; it is read as data. Any mismatch aborts before a file is written.
 * Output: `tests/fixtures/export-conformance/candidate-receipts/receipt-NN.json` for all 17 receipts, in the producer's receipt shape.
 */
const HANDOFF_SHA = '410a99fe766a6c0b3b36b696bf73b8f5a46590f9ce9170e9fbe02be3939f59c6';
const RECEIPTS_SHA = '6d1995a0091d7d9f2a836ca77b43cbcd86749adf1bb06568dad36ec7a6090da1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'tests/fixtures/export-conformance');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const fail = (message) => { throw new Error(message); };

const packet = process.argv[2];
if (!packet) fail('Usage: node scripts/prepare-export-conformance.mjs <export-producer-handoff directory>');
const handoffBytes = await readFile(join(packet, 'export-producer-handoff.json'));
if (sha256(handoffBytes) !== HANDOFF_SHA) fail('export-producer-handoff.json does not match the pinned sha256.');
const handoff = JSON.parse(handoffBytes.toString('utf8'));
if (handoff.originalHead !== '0c4c7024c68b5a52a12f3de3cec891f64aa65bd3' || handoff.actualMerge !== 'ef6dee41fdce642bc1b90a2acb2640226ec699fe') fail('Handoff producer revision differs from the pinned one.');
const receiptsBytes = await readFile(join(packet, 'candidate-postgres-composition.json'));
if (sha256(receiptsBytes) !== RECEIPTS_SHA || handoff.candidateReceipts.sha256 !== RECEIPTS_SHA) fail('candidate-postgres-composition.json does not match the pinned sha256.');
const { receipts } = JSON.parse(receiptsBytes.toString('utf8'));
if (receipts.length !== 17 || handoff.candidateReceipts.count !== 17 || handoff.candidateReceipts.artifactBytes.length !== 34) fail('Expected 17 receipts and 34 artifact files.');

const pins = JSON.parse(await readFile(join(fixtures, 'candidate-pins.json'), 'utf8'));
const verified = [];
for (const entry of handoff.candidateReceipts.artifactBytes) {
  const index = entry.receiptIndex;
  const name = entry.path.split('/').pop();
  const receipt = receipts[index]?.receipt;
  if (!receipt) fail(`Receipt ${index} is missing.`);
  // The bytes: the artifact `content` of the receipt, as UTF-8. If the raw candidate file is present in the packet it must be identical.
  const artifact = receipt.artifacts.find((candidate) => candidate.fileName === name) ?? fail(`Receipt ${index} has no ${name}.`);
  const bytes = Buffer.from(artifact.content, 'utf8');
  let raw = null;
  try { raw = await readFile(join(packet, 'candidate-artifacts', `receipt-${String(index).padStart(2, '0')}`, name)); } catch { /* raw copies are optional */ }
  if (raw !== null && !raw.equals(bytes)) fail(`Receipt ${index} ${name}: raw candidate file differs from the receipt content.`);
  if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.byteLength || `sha256:${entry.sha256}` !== entry.contentHash || artifact.contentHash !== entry.contentHash || artifact.byteLength !== entry.byteLength) fail(`Receipt ${index} ${name}: bytes differ from the handoff pin.`);
  const pin = pins.receipts[index]?.files[name];
  if (!pin || pin.sha256 !== entry.sha256 || pin.byteLength !== entry.byteLength) fail(`Receipt ${index} ${name}: committed candidate-pins.json differs from the handoff.`);
  const binding = entry.snapshotBinding;
  const committed = pins.receipts[index];
  if (committed.snapshotId !== binding.snapshotId || committed.queryContentHash !== binding.queryContentHash || committed.summaryContentHash !== binding.summaryContentHash) fail(`Receipt ${index}: committed snapshot binding differs from the handoff.`);
  const query = receipts[index].query;
  if (query.snapshotId !== binding.snapshotId || query.queryContentHash !== binding.queryContentHash || query.summaryContentHash !== binding.summaryContentHash) fail(`Receipt ${index}: receipt query binding differs from the handoff.`);
  verified.push(`${index}/${name}`);
}
if (verified.length !== 34) fail('Not all 34 artifact files were verified.');

const existing = join(fixtures, 'candidate-receipts', 'receipt-00.json');
const committedZero = JSON.parse(await readFile(existing, 'utf8'));
if (!isDeepStrictEqual(committedZero, { query: receipts[0].query, receipt: receipts[0].receipt })) fail('Committed receipt-00.json differs from the packet receipt 0.');

await mkdir(join(fixtures, 'candidate-receipts'), { recursive: true });
for (const [index, item] of receipts.entries()) {
  await writeFile(join(fixtures, 'candidate-receipts', `receipt-${String(index).padStart(2, '0')}.json`), `${JSON.stringify({ query: item.query, receipt: item.receipt }, null, 2)}\n`);
}
console.log(`Verified ${verified.length} artifact files of ${receipts.length} receipts against the handoff pins and wrote candidate-receipts/receipt-00..16.json.`);
