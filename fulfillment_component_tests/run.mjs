import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, symlink, readdir, readlink } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { checked, verifySource, verifyArchive, verifyMembers, verifyProvenance, sha256, digest } from './custody.mjs';
import { runBounded, retirePrivate } from './process.mjs';
import { manifest, saveJson, portable } from './files.mjs';
import { validateArtifacts, validateReceipt } from './receipt.mjs';

const evaluator = fileURLToPath(new URL('..', import.meta.url));
const pin = JSON.parse(await readFile(join(evaluator, 'contracts/fulfillment-producer-pin.json')));
const [source, archive, output] = process.argv.slice(2);
assert.equal(process.argv.length, 5); for (const path of [source, archive, output]) assert.ok(isAbsolute(path));
assert.equal(await realpath(dirname(output)), dirname(output)); assert.equal(resolve(output), output);
assert.ok(!output.startsWith(`${source}/`) && !source.startsWith(`${output}/`));
await mkdir(output, { mode: 0o700 });
const save = (name, value) => saveJson(output, name, value);
const receipt = { kind: 'fulfillment-bundle-component-development', status: 'failed', source: pin.revision,
  corpus_sha256: pin.corpus.sha256, platform: process.platform, node: process.version,
  accepted: false, handoffEligible: false, paid_execution_enabled: false, actual_sandbox_execution: false };
let privateRoot; let allTerminated = true; let executionStarted = false; let stage = 'preflight';
try {
  assert.equal(process.platform, 'linux'); assert.equal(process.version, `v${pin.node}`); assert.ok(process.getuid() > 0);
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(checked('git', ['-C', evaluator, 'status', '--porcelain=v1', '--untracked-files=all']), '');
  await save('evaluator-custody.json', { revision: checked('git', ['-C', evaluator, 'rev-parse', 'HEAD']), tree: checked('git', ['-C', evaluator, 'rev-parse', 'HEAD^{tree}']) });
  await save('source-custody.json', await verifySource(source, pin)); await verifyArchive(archive, pin);
  privateRoot = await realpath(await mkdtemp(join(tmpdir(), 'fulfillment-private-')));
  for (const name of ['home','cache','tmp','bin']) await mkdir(join(privateRoot, name), { mode: 0o700 });
  const npm = await realpath(checked('/usr/bin/which', ['npm'])); const node = await realpath(process.execPath);
  assert.equal(checked(node, [npm, '--version']), pin.npm);
  await symlink(npm, join(privateRoot, 'bin/npm'));
  const env = { PATH: `${join(privateRoot,'bin')}:${dirname(node)}:/usr/bin:/bin`, HOME: join(privateRoot,'home'),
    TMPDIR: join(privateRoot,'tmp'), npm_config_cache: join(privateRoot,'cache'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', CI: 'true', NO_COLOR: '1' };
  await save('runtime.json', { node: process.version, npm: pin.npm, node_sha256: sha256(await readFile(node)), npm_files: await manifest(dirname(dirname(npm))),
    python: checked('python3',['--version'],{env}), environment_keys: Object.keys(env).sort() });
  const run = async (id, command, args, cwd) => {
    allTerminated = false;
    const result = await runBounded(command, args, { cwd, env, timeout: id === 'execution' ? 240000 : 180000 }); allTerminated = result.groupAbsent;
    await save(`command-${id}.json`, { command: id, argv: portable([command,...args], [[source,'input-owner-source'],[archive,'approved-print-corpus.zip'],[privateRoot,'private-run-root'],[evaluator,'evaluator-source/'],[output,'evidence-output'],[dirname(node),'pinned-node-bin']]), exitCode: result.exitCode, failure: result.failure, groupAbsent: result.groupAbsent,
      stdout_sha256: sha256(result.stdout), stderr_sha256: sha256(result.stderr), bytes: result.bytes, duration_ms: result.duration_ms });
    assert.equal(result.failure, null); assert.equal(result.exitCode, 0); assert.equal(result.groupAbsent, true);
    return result.stdout;
  };
  stage = 'archive'; const corpus = join(privateRoot,'corpus');
  receipt.members = JSON.parse(await run('archive', 'python3', [join(evaluator,'fulfillment_component_tests/archive_reader.py'),archive,corpus,...pin.corpus.members.map(row=>row.path)]));
  verifyMembers(receipt.members,pin); await save('archive-custody.json',{ origin: pin.corpus.origin, sha256: pin.corpus.sha256, members: receipt.members });
  stage = 'bootstrap'; const build = join(privateRoot,'source');
  await run('clone','git',['-c','core.hooksPath=/dev/null','clone','--no-hardlinks','--no-checkout',source,build]);
  await run('checkout','git',['-C',build,'checkout','--detach',pin.revision]); await verifySource(build,pin);
  await run('install','npm',['ci','--no-audit','--no-fund'],build);
  assert.equal(JSON.parse(await readFile(join(build,'node_modules/typescript/package.json'))).version,pin.typescript);
  await run('build','npm',['run','build'],build);
  const dependencies = await manifest(join(build,'node_modules')); const dist = await manifest(join(build,'dist'));
  await save('dependency-custody.json',{ installed:dependencies, built:dist });
  verifyProvenance(JSON.parse(await readFile(join(build,'tests/fixtures/production-bundle/provenance.json'))),pin);
  assert.deepEqual(await readdir(join(build,'evidence')).catch(error=>{if(error.code==='ENOENT')return [];throw error;}),[]);
  stage = 'isolated_execution'; executionStarted = true;
  const execution = join(evaluator,'fulfillment_component_tests/execute.mjs');
  await run('execution','sudo',['-n','unshare','--net','--','runuser','-u',checked('id',['-un']),'--','env','-i',
    ...Object.entries(env).map(([key,value])=>`${key}=${value}`),node,execution,build,corpus,output,await readlink('/proc/self/ns/net')],build);
  const result = JSON.parse(await readFile(join(output,'execution-result.json'))); assert.equal(result.status,'passed'); receipt.owner_control=result.owner_control;
  receipt.artifacts=await validateArtifacts(output,pin);
  receipt.execution_boundary=JSON.parse(await readFile(join(output,'execution-boundary.json')));
  assert.equal(digest(await manifest(join(build,'node_modules'))),digest(dependencies));
  assert.equal(digest(await manifest(join(build,'dist'))),digest(dist));
  await verifySource(build,pin); await verifySource(source,pin); await verifyArchive(archive,pin);
  verifyMembers(await manifest(corpus),pin);
} catch(error) {
  receipt.failure={stage,code:error.code??error.name};
} finally {
  if (executionStarted) {
    try { allTerminated = allTerminated && JSON.parse(await readFile(join(output,'execution-result.json'))).termination_confirmed === true; }
    catch { allTerminated = false; }
  }
  receipt.cleanup=privateRoot?await retirePrivate(privateRoot,allTerminated):{confirmed:true,private_removed:true};
  await save('cleanup.json',receipt.cleanup);
  if(!receipt.failure){receipt.status='passed';try{validateReceipt(receipt,pin);}catch(error){receipt.status='failed';receipt.failure={stage:'receipt',code:error.code??error.name};}}
  await save('receipt.json',receipt); await save('artifact-manifest.json',await manifest(output));
}
console.log(JSON.stringify({status:receipt.status,stage:receipt.failure?.stage??'complete'}));
process.exitCode=receipt.status==='passed'?0:1;
