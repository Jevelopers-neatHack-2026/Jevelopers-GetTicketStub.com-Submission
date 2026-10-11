import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const evidenceArg = args.indexOf('--evidence-dir');
if (evidenceArg < 0 || !args[evidenceArg + 1]) {
  throw new Error('Usage: node scripts/controls-package-check.mjs --evidence-dir <path>');
}
const evidenceDir = resolve(root, args[evidenceArg + 1]);
const commandsDir = join(evidenceDir, 'commands');
const artifactDir = join(evidenceDir, 'package-artifacts');
mkdirSync(commandsDir, { recursive: true });
mkdirSync(artifactDir, { recursive: true });

const acceptedNodeVersions = ['22.23.3', '24.15.0'];
const packageFiles = [
  'src/api', 'src/contracts', 'src/controls', 'src/generation', 'src/inspection', 'src/models/index.mjs', 'src/models/index.d.mts',
  'src/models/image-adapter-core.mjs', 'src/models/image-routes.mjs', 'src/models/openai-images.mjs',
  'src/models/openrouter-images.mjs', 'src/models/codec-runtime/index.mjs', 'src/models/codec-runtime/package.json',
  'src/models/codec-runtime/package-lock.json', 'src/planning', 'src/preflight', 'src/runtime', 'src/storage',
  'src/telemetry', 'src/versions',
];
assert.ok(acceptedNodeVersions.includes(process.versions.node),
  `Run the controls package gate on a pinned runtime: ${acceptedNodeVersions.join(' or ')}`);
const commandRecords = [];
const commandEnv = {
  ...process.env,
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();

function run(label, command, argv, cwd, env = commandEnv) {
  const index = String(commandRecords.length + 1).padStart(2, '0');
  const startedAt = now();
  const started = performance.now();
  const result = spawnSync(command, argv, { cwd, env, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  const stdoutPath = join(commandsDir, `${index}-${label}.stdout`);
  const stderrPath = join(commandsDir, `${index}-${label}.stderr`);
  writeFileSync(stdoutPath, stdout);
  writeFileSync(stderrPath, stderr);
  const record = {
    label,
    command,
    argv,
    cwd,
    node_executable: process.execPath,
    node_version: process.version,
    started_at_utc: startedAt,
    completed_at_utc: now(),
    elapsed_ms: Math.round((performance.now() - started) * 1000) / 1000,
    exit_code: result.status,
    signal: result.signal ?? null,
    error: result.error ? `${result.error.name}: ${result.error.message}` : null,
    stdout_path: stdoutPath,
    stdout_bytes: stdout.length,
    stdout_sha256: sha256(stdout),
    stderr_path: stderrPath,
    stderr_bytes: stderr.length,
    stderr_sha256: sha256(stderr),
  };
  commandRecords.push(record);
  writeFileSync(join(commandsDir, `${index}-${label}.receipt.json`), `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, stdout, stderr };
}

function requireSuccess(result) {
  assert.equal(result.exit_code, 0,
    `${result.label} failed (${result.exit_code ?? result.error}): ${result.stderr.toString('utf8')}`);
}

const summary = {
  evidence_version: 'controls-package-installation/1.0',
  status: 'running',
  started_at_utc: now(),
  runtime: process.version,
  node_executable: process.execPath,
  node_versions_checked: acceptedNodeVersions,
  package_name: 'creative-engine',
  public_subpath: 'creative-engine/controls',
  package_files_allowlist: packageFiles,
  commands: commandRecords,
};
let consumerDir;
try {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(packageManifest.name, 'creative-engine');
  assert.deepEqual(packageManifest.files, packageFiles);
  assert.deepEqual(packageManifest.exports['./controls'], {
    types: './src/controls/index.d.mts',
    import: './src/controls/index.mjs',
  });

  const packDir = mkdtempSync(join(tmpdir(), 'creative-controls-pack-'));
  const packed = run('npm-pack', 'npm', ['pack', '--json', '--pack-destination', packDir], root);
  requireSuccess(packed);
  const packSummary = JSON.parse(packed.stdout.toString('utf8'));
  assert.equal(packSummary.length, 1, 'npm pack must produce one candidate package');
  const pack = packSummary[0];
  const sourceTarball = join(packDir, pack.filename);
  const tarballPath = join(artifactDir, pack.filename);
  copyFileSync(sourceTarball, tarballPath);
  const tarballBytes = readFileSync(tarballPath);
  const tarballHash = sha256(tarballBytes);

  const packedFiles = pack.files.map(file => file.path).sort();
  const forbiddenPrefix = /^(?:\.git|\.github|tests|fixtures|examples|docs|scripts|execution|build)(?:\/|$)/;
  const forbiddenSegment = /(?:^|\/)node_modules(?:\/|$)/;
  for (const file of packedFiles) {
    assert.ok(file === 'package.json' || file === 'README.md' || file === 'LICENSE' || file.startsWith('src/'),
      `Unexpected top-level package path: ${file}`);
    assert.equal(forbiddenPrefix.test(file), false, `Private or test-only path was packed: ${file}`);
    assert.equal(forbiddenSegment.test(file), false, `Installed dependency directory was packed: ${file}`);
  }
  const exportedTargets = Object.values(packageManifest.exports)
    .flatMap(conditions => Object.values(conditions))
    .filter(target => typeof target === 'string' && target.startsWith('./'))
    .map(target => target.slice(2));
  for (const target of exportedTargets) {
    assert.ok(packedFiles.includes(target), `Published export target is missing from tarball: ${target}`);
  }

  const listed = run('tar-list', 'tar', ['-tzf', tarballPath], root);
  requireSuccess(listed);
  const tarEntries = listed.stdout.toString('utf8').trim().split(/\r?\n/)
    .filter(Boolean).map(entry => entry.replace(/^package\//, '').replace(/\/$/, '')).filter(Boolean);
  for (const target of exportedTargets) {
    assert.ok(tarEntries.includes(target), `Tarball archive is missing export target: ${target}`);
  }
  for (const entry of tarEntries) {
    assert.ok(entry === 'package.json' || entry === 'README.md' || entry === 'LICENSE' || entry.startsWith('src/'),
      `Unexpected tarball entry: ${entry}`);
    assert.equal(forbiddenPrefix.test(entry), false, `Forbidden tarball entry: ${entry}`);
    assert.equal(forbiddenSegment.test(entry), false, `Installed dependency directory was packed: ${entry}`);
  }

  consumerDir = mkdtempSync(join(tmpdir(), 'creative-controls-installed-consumer-'));
  writeFileSync(join(consumerDir, 'package.json'), `${JSON.stringify({
    name: 'creative-controls-package-consumer',
    version: '1.0.0',
    private: true,
    type: 'module',
  }, null, 2)}\n`);
  for (const name of ['runtime-consumer.mjs', 'package-exports-consumer.mjs', 'package-consumer.mts', 'package-inspection-consumer.mts', 'tsconfig.json']) {
    copyFileSync(join(root, 'tests/package/controls', name), join(consumerDir, name));
  }
  const install = run('offline-install', 'npm', [
    'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--no-save', tarballPath,
  ], consumerDir);
  requireSuccess(install);

  const installedManifestPath = join(consumerDir, 'node_modules/creative-engine/package.json');
  const installedManifest = JSON.parse(readFileSync(installedManifestPath, 'utf8'));
  assert.deepEqual(installedManifest.exports['./controls'], packageManifest.exports['./controls']);
  for (const target of exportedTargets) {
    assert.ok(readFileSync(join(consumerDir, 'node_modules/creative-engine', target)));
  }

  const runtime = run('installed-runtime-consumer', process.execPath, ['runtime-consumer.mjs'], consumerDir);
  requireSuccess(runtime);
  const runtimeResult = JSON.parse(runtime.stdout.toString('utf8').trim());
  assert.ok(runtimeResult.entrypoint.endsWith('/node_modules/creative-engine/src/controls/index.mjs'), runtimeResult.entrypoint);
  assert.equal(runtimeResult.sqlite_replay, 'passed across store restart');
  assert.deepEqual(runtimeResult.counters, { jobs: 1, image_calls: 0, jev_calls: 0 });

  const exportsRuntime = run('installed-public-exports-consumer', process.execPath, ['package-exports-consumer.mjs'], consumerDir);
  requireSuccess(exportsRuntime);
  const publicExportsResult = JSON.parse(exportsRuntime.stdout.toString('utf8').trim());
  assert.deepEqual(publicExportsResult.public_exports_imported.map(item => item.specifier),
    Object.keys(installedManifest.exports).map(subpath => `creative-engine/${subpath.slice(2)}`));

  const tscPath = join(root, 'examples/frontend-action-roundtrip/node_modules/typescript/bin/tsc');
  const compilerVersion = run('typescript-version', process.execPath, [tscPath, '--version'], consumerDir);
  requireSuccess(compilerVersion);
  assert.equal(compilerVersion.stdout.toString('utf8').trim(), 'Version 5.9.3');
  const types = run('strict-installed-types', process.execPath, [tscPath, '-p', 'tsconfig.json'], consumerDir);
  requireSuccess(types);
  assert.equal(readFileSync(join(consumerDir, 'package-consumer.mts'), 'utf8').includes('../../../src/'), false,
    'Installed package consumer must not alias repository source');

  summary.status = 'passed';
  summary.completed_at_utc = now();
  summary.package_version = packageManifest.version;
  summary.tarball = {
    filename: pack.filename,
    path: tarballPath,
    bytes: tarballBytes.length,
    sha256: tarballHash,
    files: packedFiles,
    archive_entries: tarEntries,
    export_targets: exportedTargets,
  };
  summary.consumer = {
    installed_from_tarball: tarballPath,
    install_mode: 'fresh isolated directory; offline; scripts disabled; no registry package resolution required',
    installed_manifest_path: installedManifestPath,
    runtime_result: runtimeResult,
    public_exports_runtime: publicExportsResult,
    typescript: compilerVersion.stdout.toString('utf8').trim(),
    typecheck: 'strict NodeNext/ES2022, skipLibCheck false, positive and expected-negative assertions passed',
  };
} catch (error) {
  summary.status = 'failed';
  summary.completed_at_utc = now();
  summary.error = `${error.name}: ${error.message}`;
  process.exitCode = 1;
} finally {
  summary.commands = commandRecords;
  writeFileSync(join(evidenceDir, 'package-check-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  if (consumerDir) rmSync(consumerDir, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
