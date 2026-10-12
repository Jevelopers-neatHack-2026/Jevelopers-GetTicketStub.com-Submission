import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = process.env.IE_COMPARISON_EVIDENCE;
assert.ok(source, 'IE_COMPARISON_EVIDENCE must identify a real complete receipt run');
const comparer = fileURLToPath(new URL('./compare-receipts.mjs', import.meta.url));

for (const fault of ['none', 'dirty', 'source-digest', 'revision']) {
  test(`receipt comparison ${fault === 'none' ? 'accepts clean identity' : `rejects ${fault}`}`, t => {
    // Given independent copies of eight real passing receipts, with one controlled identity fault.
    const root = mkdtempSync(join(tmpdir(), 'contract-comparison-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const lane of ['old', 'new']) {
      for (const surface of ['source', 'installed']) {
        for (const scope of ['candidate', 'full']) {
          const relative = join(lane, `${surface}-${scope}`);
          cpSync(join(source, relative), join(root, relative), { recursive: true });
        }
      }
    }
    const directory = join(root, 'new', 'installed-full');
    const names = readdirSync(directory).filter(name => name.startsWith('contracts-'));
    assert.equal(names.length, 1);
    const path = join(directory, names[0], 'contracts.json');
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    switch (fault) {
      case 'none': break;
      case 'dirty': receipt.integration_dirty = true; break;
      case 'source-digest': receipt.integration_source_digest = 'f'.repeat(64); break;
      case 'revision': receipt.integration_revision = 'f'.repeat(40); break;
      default: throw new TypeError(fault);
    }
    writeFileSync(path, JSON.stringify(receipt));
    // When the real comparison entry point processes the complete evidence set.
    const result = spawnSync(process.execPath, [comparer, root], { encoding: 'utf8', timeout: 10000 });
    // Then valid identity passes and each controlled corruption exits with an assertion failure.
    assert.equal(result.error, undefined);
    assert.equal(result.status, fault === 'none' ? 0 : 1, result.stderr);
    if (fault !== 'none') assert.match(result.stderr, /AssertionError/);
  });
}
