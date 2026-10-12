import assert from 'node:assert/strict';
import { sanitizedJson } from './receipt.mjs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function fileManifest(root) {
  const entries = [];
  async function walk(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(join(dir, entry.name), `${relative}/`);
      else if (entry.isFile()) {
        const bytes = await readFile(join(dir, entry.name));
        entries.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await walk(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export async function verifySource(source, pin, output) {
  const git = args => {
    const result = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(git(['rev-parse', 'HEAD']), pin.revision);
  assert.equal(git(['rev-parse', 'HEAD^{tree}']), pin.tree);
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '');
  const archive = spawnSync('git', ['-C', source, 'archive', '--format=tar', 'HEAD'], { maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
  assert.equal(archive.status, 0);
  assert.equal(sha256(archive.stdout), pin.archive_sha256);
  await writeFile(join(output, 'producer-source.tar'), archive.stdout);
  assert.equal(sha256(await readFile(join(source, 'package-lock.json'))), pin.lockfile_sha256);
  assert.equal(sha256(await readFile(join(source, 'vendor/shared-contracts-0.3.0-proposal.tgz'))), pin.contract.archive_sha256);
  const lock = JSON.parse(await readFile(join(source, 'contracts.lock.json'), 'utf8'));
  assert.equal(lock.status, 'proposal_only');
  assert.equal(lock.adoption_accepted, false);
  assert.equal(lock.producer.head, pin.contract.revision);
  assert.equal(lock.producer.archive_sha256, pin.contract.archive_sha256);
  const migrations = (await readdir(join(source, 'migrations'))).sort();
  assert.deepEqual(migrations, pin.migrations.map(row => row.name));
  assert.equal(migrations.length, 10);
  for (const row of pin.migrations) assert.equal(sha256(await readFile(join(source, 'migrations', row.name))), row.sha256);
  await writeFile(join(output, 'source-custody.json'), JSON.stringify({ revision: pin.revision, tree: pin.tree, clean: true, archiveSha256: pin.archive_sha256, migrations: pin.migrations }, null, 2));
}

export async function buildSource(source, context) {
  const { pin, output, environment, sanitize } = context;
  assert.equal(process.version, `v${pin.node}`);
  const commands = [['npm', ['--version']], ['npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']],
    ['npm', ['run', 'typecheck']], ['npm', ['run', 'build']]];
  for (const [index, [command, args]] of commands.entries()) {
    const result = spawnSync(command, args, { cwd: source, env: environment, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    await writeFile(join(output, `build-${index}.json`), sanitizedJson({ command, args, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }, sanitize));
    assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
    if (index === 0) assert.equal(result.stdout.trim(), pin.npm);
  }
  const ts = JSON.parse(await readFile(join(source, 'node_modules/typescript/package.json'), 'utf8'));
  assert.equal(ts.version, pin.typescript);
  await writeFile(join(output, 'build-manifest.json'), JSON.stringify(await fileManifest(join(source, 'dist')), null, 2));
  await writeFile(join(output, 'dependency-manifest.json'), JSON.stringify(await fileManifest(join(source, 'node_modules')), null, 2));
}

export async function recordEvaluator(directory, output) {
  const result = spawnSync('git', ['-C', directory, 'show', '-s', '--format=%H%n%T', 'HEAD'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0);
  const [revision, tree] = result.stdout.trim().split('\n');
  const status = spawnSync('git', ['-C', directory, 'status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(status.status, 0);
  const clean = status.stdout.trim() === '';
  await writeFile(join(output, 'evaluator-custody.json'), JSON.stringify({ revision, tree, clean, files: await fileManifest(directory) }, null, 2));
  assert.equal(clean, true, 'Evaluator source must be clean before executing component scenarios');
}
