import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const hook = fileURLToPath(new URL('../scripts/consumer-import-hook.mjs', import.meta.url));
const probes = [
  "process.getBuiltinModule('net')",
  "process.getBuiltinModule('node:child_process')",
  "new WebSocket('ws://127.0.0.1:1')",
  "await import('node:inspector')",
  "await import('node:inspector/promises')",
  "await import('node:https')",
  "const { createRequire } = await import('node:module'); createRequire(import.meta.url)('node:http')",
  "fetch('http://127.0.0.1:1')"
];
test('offline driver denies alternate builtin, WebSocket and debugger entry points', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sc-offline-entrypoints-'));
  try {
    const config = join(directory, 'binding.json');
    await writeFile(config, JSON.stringify({ snapshot: root, files: {} }));
    for (const probe of probes) {
      const driver = join(directory, 'driver.mjs');
      await writeFile(driver, probe);
      const result = spawnSync(process.execPath, ['--import', hook, driver], {
        encoding: 'utf8', timeout: 5000,
        env: { PATH: process.env.PATH, SHARED_CONTRACTS_BINDING_CONFIG: config }
      });
      assert.equal(result.error, undefined, probe);
      assert.equal(result.status, 1, probe);
      assert.match(result.stderr, /Offline consumer driver/, probe);
    }
    const driver = join(directory, 'allowed.mjs');
    await writeFile(driver, "import { createRequire } from 'node:module'; console.log(typeof process.getBuiltinModule('path').join, typeof createRequire(import.meta.url)('node:fs').readFileSync);");
    const result = spawnSync(process.execPath, ['--import', hook, driver], {
      encoding: 'utf8', timeout: 5000,
      env: { PATH: process.env.PATH, SHARED_CONTRACTS_BINDING_CONFIG: config }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'function function');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
