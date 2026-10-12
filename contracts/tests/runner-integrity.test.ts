import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repo = process.cwd();
const installed = join(repo, 'node_modules/@jevelopers/shared-contracts');
let isolated = '';
const run = () => spawnSync(process.execPath, ['scripts/run-contract-driver.mjs'], { cwd: isolated, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, TD01B_CONSUMER_SHA: 'a'.repeat(40) } });
const manifestPath = () => join(isolated, 'node_modules/@jevelopers/shared-contracts/generated/package-content-manifest.json');

describe('TD-01B runner refuses a package whose manifest was edited to match tampered bytes', () => {
  beforeAll(() => {
    isolated = mkdtempSync(join(tmpdir(), 'td01b-tamper-'));
    for (const dir of ['scripts', 'contracts', 'src/data']) mkdirSync(join(isolated, dir), { recursive: true });
    for (const file of ['scripts/run-contract-driver.mjs', 'scripts/package-verify.mjs', 'contracts/contract-driver.mjs', 'contracts/domain-cases.mjs', 'contracts/shared-contracts.pin.json', 'src/data/shared-contracts-adapter.ts']) cpSync(join(repo, file), join(isolated, file));
    mkdirSync(join(isolated, 'node_modules/@jevelopers'), { recursive: true });
    cpSync(installed, join(isolated, 'node_modules/@jevelopers/shared-contracts'), { recursive: true });
    writeFileSync(join(isolated, 'package.json'), '{"type":"module"}');
  }, 60_000);
  afterAll(() => { if (isolated.startsWith(tmpdir()) && existsSync(isolated)) rmSync(isolated, { recursive: true, force: true }); });

  it('control: the pristine isolated copy passes', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe('passed');
  }, 60_000);
  it('exits 1 when tooling/runtime.mjs is tampered with and only its manifest entry is updated', () => {
    const file = join(isolated, 'node_modules/@jevelopers/shared-contracts/tooling/runtime.mjs');
    appendFileSync(file, '\n// deliberate tamper\n');
    const manifest = JSON.parse(readFileSync(manifestPath(), 'utf8'));
    manifest.files['tooling/runtime.mjs'] = 'sha256:' + createHash('sha256').update(readFileSync(file)).digest('hex');
    writeFileSync(manifestPath(), JSON.stringify(manifest));
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('recomputed content digest differs from the pin');
    expect(result.stdout).toBe('');
  }, 60_000);
  it('exits 1 for an unlisted executable file even when every listed hash is right', () => {
    // Restore the pristine package first.
    cpSync(installed, join(isolated, 'node_modules/@jevelopers/shared-contracts'), { recursive: true });
    expect(run().status).toBe(0);
    writeFileSync(join(isolated, 'node_modules/@jevelopers/shared-contracts/tooling/extra.mjs'), 'export {};\n');
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unlisted executable file');
  }, 60_000);
});
