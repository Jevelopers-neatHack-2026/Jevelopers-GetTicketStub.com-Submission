import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson, hashManifest } from '../../scripts/package-verify.mjs';
import { kit } from './support';

const repo = process.cwd();
const installed = join(repo, 'node_modules/@jevelopers/shared-contracts');
let isolated = '';
const run = () => spawnSync(process.execPath, ['scripts/run-contract-driver.mjs'], { cwd: isolated, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, TD01B_CONSUMER_SHA: 'a'.repeat(40) } });
const pkg = () => join(isolated, 'node_modules/@jevelopers/shared-contracts');
const restore = () => { rmSync(pkg(), { recursive: true, force: true }); cpSync(installed, pkg(), { recursive: true }); };
const manifestPath = () => join(isolated, 'node_modules/@jevelopers/shared-contracts/generated/package-content-manifest.json');

describe('TD-01B runner refuses a package whose manifest was edited to match tampered bytes', () => {
  beforeAll(() => {
    isolated = mkdtempSync(join(tmpdir(), 'td01b-tamper-'));
    for (const dir of ['scripts', 'contracts', 'src/data']) mkdirSync(join(isolated, dir), { recursive: true });
    for (const file of ['scripts/run-contract-driver.mjs', 'scripts/package-verify.mjs', 'contracts/contract-driver.mjs', 'contracts/domain-cases.mjs', 'contracts/shared-contracts.pin.json', 'src/data/shared-contracts-adapter.ts']) cpSync(join(repo, file), join(isolated, file));
    mkdirSync(join(isolated, 'node_modules/@jevelopers'), { recursive: true });
    restore();
    writeFileSync(join(isolated, 'package.json'), '{"type":"module"}');
  }, 60_000);
  afterAll(() => { if (isolated.startsWith(tmpdir()) && existsSync(isolated)) rmSync(isolated, { recursive: true, force: true }); });

  beforeEach(() => restore());
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
  it('exits 1 for an unlisted file of any kind even when every listed hash is right', () => {
    expect(run().status).toBe(0);
    for (const name of ['tooling/extra.mjs', 'tooling/extra.ts', 'tooling/extra.json', 'extra.txt']) {
      writeFileSync(join(pkg(), name), 'x');
      const result = run();
      expect(result.status, name).toBe(1);
      expect(result.stderr).toContain('unlisted file in package');
      rmSync(join(pkg(), name));
    }
    mkdirSync(join(pkg(), 'node_modules/evil'), { recursive: true });
    writeFileSync(join(pkg(), 'node_modules/evil/index.js'), 'x');
    expect(run().status).toBe(1);
  }, 120_000);
  it('exits 1 and executes nothing for an entry-point symlink to an external copy with identical bytes and a modified sibling runtime', () => {
    const external = mkdtempSync(join(tmpdir(), 'td01b-external-'));
    const marker = join(external, 'symlink-code-executed');
    try {
      cpSync(installed, join(external, 'pkg'), { recursive: true });
      appendFileSync(join(external, 'pkg/tooling/runtime.mjs'), `\nimport { writeFileSync as mark } from 'node:fs';\nmark(${JSON.stringify(marker)}, 'unverified runtime executed');\n`);
      rmSync(join(pkg(), 'generated/index.mjs'));
      symlinkSync(join(external, 'pkg/generated/index.mjs'), join(pkg(), 'generated/index.mjs'));
      expect(readFileSync(join(pkg(), 'generated/index.mjs'), 'utf8')).toBe(readFileSync(join(installed, 'generated/index.mjs'), 'utf8')); // identical bytes
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('symlink in package: generated/index.mjs');
      expect(existsSync(marker)).toBe(false);
    } finally { rmSync(external, { recursive: true, force: true }); }
  }, 60_000);
  it('exits 1 for a symlinked package root pointing outside node_modules, and for a symlinked directory', () => {
    const external = mkdtempSync(join(tmpdir(), 'td01b-external-'));
    try {
      cpSync(installed, join(external, 'pkg'), { recursive: true });
      rmSync(pkg(), { recursive: true, force: true });
      symlinkSync(join(external, 'pkg'), pkg());
      expect(run().status).toBe(1);
      restore();
      cpSync(join(pkg(), 'tooling'), join(external, 'tooling'), { recursive: true });
      rmSync(join(pkg(), 'tooling'), { recursive: true });
      symlinkSync(join(external, 'tooling'), join(pkg(), 'tooling'));
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('symlink in package: tooling');
    } finally { rmSync(external, { recursive: true, force: true }); }
  }, 60_000);
});

describe('TD-01B independent canonical hash helper', () => {
  const files = JSON.parse(readFileSync(join(installed, 'generated/package-content-manifest.json'), 'utf8')).files as Record<string, string>;
  const fixtures = JSON.parse(readFileSync(join(installed, 'generated/fixture-manifest.json'), 'utf8')).files as Record<string, string>;
  it('matches the producer hashManifest on the real file maps', () => {
    expect(hashManifest(files)).toBe(kit.hashManifest(files));
    expect(hashManifest(fixtures)).toBe(kit.hashManifest(fixtures));
  });
  it.each([
    [9007199254740992], [{ a: 1 }], [{ a: ['x'] }], [[]], [{ ['\ud800']: 'x' }], [{ a: '\ud800' }], [{ a: null }], [null], ['text'],
  ])('rejects non-string-map input %j instead of hashing it', (value) => {
    expect(() => canonicalJson(value)).toThrow();
  });
});
