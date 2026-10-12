import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { sourceCustody, installedCustody, checked, sha256, digest, manifest } from './custody.mjs';
import { runBounded } from './process.mjs';
import { collectObservations } from './observations.mjs';
import { parseTap, sanitizedTap, pgUnavailable, validateReceipt, validateRecordedReceipt } from './receipt.mjs';
import { dockerPort, startObserver, readHistory, parseEvents, cleanupOwned, retirePrivate } from './lifecycle.mjs';

const evaluator = dirname(dirname(fileURLToPath(import.meta.url)));
const pin = JSON.parse(await readFile(join(evaluator, 'contracts/app-recovery-producer-pin.json'), 'utf8'));
const [source, output] = process.argv.slice(2);
assert.ok(source && output && isAbsolute(source) && isAbsolute(output));
assert.equal(resolve(output), output); assert.equal(await realpath(dirname(output)), dirname(output));
assert.ok(!output.startsWith(`${source}/`) && !source.startsWith(`${output}/`));
await mkdir(output, { mode: 0o700 });
const save = async (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const receipt = { kind: 'app-recovery-component-development', status: 'failed', source: pin.revision, tree: pin.tree,
  mode: 'synthetic-owner-fixtures', paid_execution_enabled: false, adoption_accepted: false,
  platform: process.platform, node: process.version, fixed_seed: 'unsupported', fixed_clock: 'unsupported',
  os_egress_containment: 'not_claimed', postgres: { observation_basis: 'owner_assertion', independent: pgUnavailable } };
let privateRoot; let env; let docker; let context; let observer; let controller; let command; let phase = 'preflight';
let terminationConfirmed = true;
let cleanup = { confirmed: false, owned: [], unknown: ['execution_not_started'], private_removed: false };
try {
  assert.equal(process.platform, 'linux'); assert.equal(process.version, `v${pin.node}`);
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.env.RUNNER_OS, 'Linux'); assert.equal(process.env.APP_RECOVERY_DISPOSABLE_RUNNER, '1');
  assert.match(process.env.GITHUB_RUN_ID ?? '', /^\d+$/);
  assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'ambient remote daemon rejected');
  assert.equal(checked('git', ['-C', evaluator, 'status', '--porcelain=v1', '--untracked-files=all']), '');
  await save('evaluator-custody.json', { revision: checked('git', ['-C', evaluator, 'rev-parse', 'HEAD']), tree: checked('git', ['-C', evaluator, 'rev-parse', 'HEAD^{tree}']) });
  await save('source-custody.json', await sourceCustody(source, pin));
  privateRoot = await mkdtemp(join(tmpdir(), 'app-recovery-private-'));
  for (const name of ['home', 'cache', 'tmp']) await mkdir(join(privateRoot, name), { mode: 0o700 });
  const nodeDir = dirname(await realpath(process.execPath));
  const npmPath = await realpath(checked('/usr/bin/which', ['npm']));
  assert.equal(checked(process.execPath, [npmPath, '--version']), pin.npm);
  // Executable resolution is fixed for the owner, including npm's shell script invocation.
  const bin = join(privateRoot, 'bin'); await mkdir(bin, { mode: 0o700 });
  const { symlink } = await import('node:fs/promises');
  await symlink(npmPath, join(bin, 'npm'));
  env = { PATH: `${bin}:${nodeDir}:/usr/bin:/bin`, HOME: join(privateRoot, 'home'), TMPDIR: join(privateRoot, 'tmp'), npm_config_cache: join(privateRoot, 'cache'), CI: 'true', NO_COLOR: '1' };
  const runtime = { node: process.version, npm: pin.npm, platform: process.platform,
    node_sha256: sha256(await readFile(process.execPath)), npm_sha256: sha256(await readFile(npmPath)),
    npm_files: await manifest(dirname(dirname(npmPath))), environment_keys: Object.keys(env).sort(),
    docker: checked('docker', ['version', '--format', '{{.Server.Version}}'], { env }),
    postgres_image_id: checked('docker', ['image', 'inspect', '--format', '{{.Id}}', pin.postgres], { env }), runner: 'github-hosted-disposable' };
  await save('runtime.json', runtime);
  phase = 'bootstrap';
  terminationConfirmed = false;
  const install = await runBounded('npm', ['ci', '--no-audit', '--no-fund'], { cwd: source, env, timeout: 180000, limit: 4 * 1024 * 1024 });
  terminationConfirmed = install.groupAbsent;
  await save('bootstrap.json', { argv: ['npm', 'ci', '--no-audit', '--no-fund'], exitCode: install.exitCode, failure: install.failure, groupAbsent: install.groupAbsent, stdout_sha256: sha256(install.stdout), stderr_sha256: sha256(install.stderr) });
  assert.equal(install.exitCode, 0); assert.equal(install.failure, null); assert.equal(install.groupAbsent, true);
  await sourceCustody(source, pin);
  const installed = await installedCustody(source); await save('installed-custody.json', installed);
  docker = dockerPort(env);
  const baseline = docker.inventory(); assert.deepEqual(baseline, [], 'dedicated empty Docker daemon required');
  context = { baseline, image: pin.postgres, since: Math.floor(Date.now() / 1000), until: null, events: [] };
  await save('container-lifecycle.json', context);
  controller = new AbortController(); observer = startObserver(context, env, controller.signal);
  phase = 'owner_command';
  terminationConfirmed = false;
  command = await runBounded('npm', ['run', 'verify:creative-host'], { cwd: source, env, timeout: 180000 });
  terminationConfirmed = command.groupAbsent;
  receipt.command = { argv: ['npm', 'run', 'verify:creative-host'], script: pin.script, exitCode: command.exitCode, exitSignal: command.exitSignal, failure: command.failure, groupAbsent: command.groupAbsent, duration_ms: command.duration_ms, bytes: command.bytes, raw_stdout_sha256: sha256(command.stdout), raw_stderr_sha256: sha256(command.stderr) };
  await save('command.json', receipt.command);
  await writeFile(join(output, 'owner.tap'), sanitizedTap(command.stdout));
  await save('owner-stderr.json', { bytes: Buffer.byteLength(command.stderr), sha256: sha256(command.stderr), content: 'withheld_unstructured_owner_diagnostics' });
  assert.equal(command.failure, null); assert.equal(command.exitCode, 0); assert.equal(command.groupAbsent, true);
  receipt.tests = parseTap(command.stdout);
  phase = 'observations';
  const sqlite = await collectObservations(env.TMPDIR); await save('sqlite-observations.json', sqlite);
  receipt.sqlite = { validated: true, artifact: 'sqlite-observations.json', sha256: sha256(await readFile(join(output, 'sqlite-observations.json'))) };
  assert.equal((await installedCustody(source)).sha256, installed.sha256, 'installed bytes changed during owner run');
  await sourceCustody(source, pin);
} catch (error) {
  receipt.failure = { phase, code: error.code ?? error.name };
} finally {
  if (observer) {
    try {
      context.until = Math.ceil(Date.now() / 1000);
      const history = readHistory(context, env);
      controller.abort();
      const observed = await observer;
      terminationConfirmed = terminationConfirmed && observed.groupAbsent;
      assert.ok(observed.groupAbsent && [null, 'observer_stopped'].includes(observed.failure), 'observer incomplete');
      context.events = parseEvents(history, context);
      context.observer = { failure: observed.failure, group_absent: observed.groupAbsent, history_sha256: sha256(history), stream_sha256: sha256(observed.stdout) };
      await save('container-lifecycle.json', context);
      assert.equal(command?.groupAbsent, true, 'owner termination uncertain');
      cleanup = await cleanupOwned(context, docker);
      const ids = new Set(context.events.filter(row => row.action === 'create').map(row => row.id));
      assert.equal(ids.size, 1, 'positive owned-container evidence required');
      for (const id of ids) assert.ok(context.events.some(row => row.id === id && row.action === 'start'));
    } catch (error) {
      controller.abort(); const observed = await observer;
      terminationConfirmed = terminationConfirmed && observed.groupAbsent;
      cleanup.confirmed = false; cleanup.unknown = ['lifecycle_or_ownership_unconfirmed'];
      receipt.failure ??= { phase: 'cleanup', code: error.code ?? error.name };
    }
  }
  if (privateRoot) Object.assign(cleanup, await retirePrivate(privateRoot, { terminationConfirmed, resourceCleanupConfirmed: !context || cleanup.confirmed }));
  receipt.cleanup = cleanup;
  await save('cleanup.json', cleanup);
  if (!receipt.failure) {
    receipt.status = 'passed';
    try { validateReceipt(receipt, pin); } catch (error) { receipt.status = 'failed'; receipt.failure = { phase: 'receipt', code: error.code ?? error.name }; }
  }
  await save('receipt.json', receipt);
  if (receipt.status === 'passed') {
    try { await validateRecordedReceipt(output, pin); } catch (error) {
      receipt.status = 'failed'; receipt.failure = { phase: 'artifact_revalidation', code: error.code ?? error.name };
      await save('receipt.json', receipt);
    }
  }
  await save('artifact-manifest.json', await manifest(output));
}
console.log(JSON.stringify({ status: receipt.status, phase: receipt.failure?.phase ?? 'complete', output }));
process.exitCode = receipt.status === 'passed' ? 0 : 1;
