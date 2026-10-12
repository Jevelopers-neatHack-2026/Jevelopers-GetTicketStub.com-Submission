import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const launcher = fileURLToPath(new URL('../../../tools/contracts/installed-research-consumer.mjs', import.meta.url));

test('wrong archive fails before any install/import command and preserves its failing receipt', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ei-installed-research-negative-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'wrong.tgz');
  const output = path.join(directory, 'failed-attempt');
  await writeFile(archive, 'not the owner-authorized archive');
  await assert.rejects(exec(process.execPath, [launcher, '--archive', archive, '--output', output]),
    (error) => error.code === 1);
  const original = await readFile(path.join(output, 'receipt.json'), 'utf8');
  const receipt = JSON.parse(original);
  assert.equal(receipt.diagnostic_status, 'failed');
  assert.equal(receipt.consumer_acceptance, 'INCOMPATIBLE_HOLD');
  assert.deepEqual(receipt.commands, []);
  assert.match(receipt.failures[0].message, /ARCHIVE_DIGEST_MISMATCH/);
  await assert.rejects(exec(process.execPath, [launcher, '--archive', archive, '--output', output]),
    (error) => error.code === 1 && error.stderr.includes('OUTPUT_EXISTS'));
  assert.equal(await readFile(path.join(output, 'receipt.json'), 'utf8'), original);
});
