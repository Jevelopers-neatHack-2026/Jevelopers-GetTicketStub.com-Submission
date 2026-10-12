import assert from 'node:assert/strict';
import { readFile, readlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeScenarios } from './scenarios.mjs';
import { runBounded } from './process.mjs';
import { sha256 } from './custody.mjs';
import { saveJson, portable } from './files.mjs';

const [source, corpus, output, hostNamespace] = process.argv.slice(2);
const pin = JSON.parse(await readFile(new URL('../contracts/fulfillment-producer-pin.json', import.meta.url)));
const environment = { ...process.env };
let stage = 'namespace'; let status = 'failed'; let owner; let terminationConfirmed = true;
try {
  assert.equal(process.platform, 'linux'); assert.equal(process.version, `v${pin.node}`); assert.ok(process.getuid() > 0);
  const namespace = await readlink('/proc/self/ns/net'); assert.notEqual(namespace, hostNamespace);
  const interfaces = (await readFile('/proc/net/dev', 'utf8')).trim().split('\n').slice(2).map(line => line.split(':')[0].trim());
  assert.deepEqual(interfaces, ['lo']);
  const routes = await readFile('/proc/net/route', 'utf8'); assert.equal(routes.trim().split('\n').length, 1);
  await saveJson(output, 'execution-boundary.json', { namespace_separate: true, interfaces: ['lo'], ipv4_route_count: 0, uid_nonroot: true, claim: 'network_namespace_only' });
  stage = 'owner_control';
  terminationConfirmed = false;
  const command = await runBounded('./scripts/verify-fulfillment', ['--suite', 'package', '--mode', 'simulated', '--evidence-dir', 'evidence/FC-08'], { cwd: source, env: environment, timeout: 150000 });
  terminationConfirmed = command.groupAbsent;
  await saveJson(output, 'owner-command.json', { argv: ['./scripts/verify-fulfillment','--suite','package','--mode','simulated','--evidence-dir','evidence/FC-08'],
    exitCode: command.exitCode, failure: command.failure, groupAbsent: command.groupAbsent, stdout_sha256: sha256(command.stdout), stderr_sha256: sha256(command.stderr), bytes: command.bytes });
  assert.equal(command.groupAbsent, true);
  const resultPath = join(source, 'evidence/FC-08/result.json'); const stat = await lstat(resultPath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2 * 1024 * 1024);
  const resultBytes = await readFile(resultPath); owner = JSON.parse(resultBytes);
  await saveJson(output, 'owner-control-result.json', { basis: 'owner_assertion', raw_sha256: sha256(resultBytes), result: portable(owner,
    [[source, 'owner-source'], [fileURLToPath(new URL('..', import.meta.url)), 'evaluator-source'], [environment.HOME, 'private-home'], [environment.TMPDIR, 'private-tmp']]) });
  assert.equal(command.exitCode, 0); assert.equal(command.failure, null);
  assert.equal(owner.status, 'passed'); assert.equal(owner.suite, 'package'); assert.equal(owner.mode, 'simulated');
  const assessment = owner.packageAssessment;
  assert.equal(assessment.accepted, false); assert.equal(assessment.handoffEligible, false); assert.equal(assessment.authorityIssued, false);
  assert.deepEqual(assessment.localFixtureCounts, { total: 166, passed: 166, failed: 0 });
  stage = 'direct_scenarios'; await executeScenarios(source, { corpus, output, pin });
  status = 'passed';
} catch (error) {
  await saveJson(output, 'execution-failure.json', { stage, code: error.code ?? error.name });
} finally {
  await saveJson(output, 'execution-result.json', { status, stage, termination_confirmed: terminationConfirmed, owner_control: owner ? { basis: 'owner_assertion', status: owner.status, localFixtureCounts: owner.packageAssessment?.localFixtureCounts ?? null } : null });
}
process.exitCode = status === 'passed' ? 0 : 1;
