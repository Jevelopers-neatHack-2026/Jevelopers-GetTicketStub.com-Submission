import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,realpath,symlink,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {verifySource,verifyInstalled,verifyCachedArchive,checked,sha256,digest} from './custody.mjs';
import {manifest,saveJson,portable} from '../fulfillment_component_tests/files.mjs';
import {runBounded,retirePrivate} from '../fulfillment_component_tests/process.mjs';
import {validateReports,validateReceipt} from './receipt.mjs';

const evaluator=fileURLToPath(new URL('..',import.meta.url));
const pins=JSON.parse(await readFile(join(evaluator,'contracts/decision-failure-producer-pins.json')));
const [harness,creative,output]=process.argv.slice(2);
assert.equal(process.argv.length,5);for(const path of[harness,creative,output])assert.ok(isAbsolute(path));
assert.equal(resolve(output),output);assert.equal(await realpath(dirname(output)),dirname(output));
assert.ok(![harness,creative].some(path=>output.startsWith(`${path}/`)||path.startsWith(`${output}/`)));
await mkdir(output,{mode:0o700});const save=(name,value)=>saveJson(output,name,value);
const receipt={kind:'decision-failure-component-development',status:'failed',mode:'intercepted_mock_only',synthetic_authority:true,
  accepted:false,paid_execution_enabled:false,cost:'unknown',harness:pins.harness.revision,creative:pins.creative.revision,node:process.version,platform:process.platform};
let privateRoot;let confirmed=true;let controlsStarted=false;let stage='preflight';
try{
  assert.equal(process.platform,'linux');assert.equal(process.version,`v${pins.node}`);
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
  assert.equal(checked('git',['-C',evaluator,'status','--porcelain=v1','--untracked-files=all']),'');
  await save('evaluator-custody.json',{revision:checked('git',['-C',evaluator,'rev-parse','HEAD']),tree:checked('git',['-C',evaluator,'rev-parse','HEAD^{tree}'])});
  await save('harness-source.json',await verifySource(harness,pins.harness));await save('creative-source.json',await verifySource(creative,pins.creative));
  privateRoot=await realpath(await mkdtemp(join(tmpdir(),'decision-failure-')));
  for(const name of['home','cache','tmp','bin'])await mkdir(join(privateRoot,name),{mode:0o700});
  const npm=await realpath(checked('/usr/bin/which',['npm']));const node=await realpath(process.execPath);
  await symlink(npm,join(privateRoot,'bin/npm'));
  const env={PATH:`${join(privateRoot,'bin')}:${dirname(node)}:/usr/bin:/bin`,HOME:join(privateRoot,'home'),TMPDIR:join(privateRoot,'tmp'),
    npm_config_cache:join(privateRoot,'cache'),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',CI:'true',NO_COLOR:'1'};
  const roots=[[harness,'harness-input'],[creative,'creative-input'],[privateRoot,'private-run-root'],[evaluator,'evaluator-source/'],[output,'evidence-output'],[dirname(node),'pinned-node-bin']];
  await save('runtime.json',{node:process.version,node_sha256:sha256(await readFile(node)),npm:checked(node,[npm,'--version'],{env}),npm_files:await manifest(dirname(dirname(npm))),environment_keys:Object.keys(env).sort()});
  const run=async(id,command,args,options={})=>{
    confirmed=false;const result=await runBounded(command,args,{env,timeout:180000,...options});confirmed=result.groupAbsent;
    await save(`command-${id}.json`,{argv:portable([command,...args],roots),exitCode:result.exitCode,failure:result.failure,groupAbsent:result.groupAbsent,
      bytes:result.bytes,duration_ms:result.duration_ms,stdout_sha256:sha256(result.stdout),stderr_sha256:sha256(result.stderr)});
    if(id==='matrix'||id==='controls')await writeFile(join(output,`${id}.tap`),portable(result.stdout+result.stderr,roots),{flag:'wx'});
    assert.equal(result.exitCode,0);assert.equal(result.failure,null);assert.equal(result.groupAbsent,true);
  };
  stage='bootstrap';const build=join(privateRoot,'harness');
  await run('clone','git',['-c','core.hooksPath=/dev/null','clone','--no-hardlinks','--no-checkout',harness,build]);
  await run('checkout','git',['-C',build,'checkout','--detach',pins.harness.revision]);
  await verifySource(build,pins.harness);
  await run('install','npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:build});
  await save('creative-archive.json',await verifyCachedArchive(env.npm_config_cache,pins));
  const installed=await verifyInstalled(build,creative);await save('installed-creative.json',installed);
  const dependencies=await manifest(join(build,'node_modules'));await save('dependency-custody.json',dependencies);
  stage='matrix';
  await run('matrix',node,['--test','--test-concurrency=1',join(evaluator,'decision_failure_component_tests/scenarios.test.mjs')],
    {env:{...env,DF_HARNESS:build,DF_CREATIVE:creative,DF_OUTPUT:output},timeout:90000});
  receipt.reports=await validateReports(output);
  stage='negative_controls';controlsStarted=true;
  await run('controls',node,['--test',join(evaluator,'decision_failure_component_tests/receipt.test.mjs')],
    {env:{...env,DF_CASES:output,DF_TEST_EVIDENCE:join(output,'controls')},timeout:30000});
  assert.equal(digest(await manifest(join(build,'node_modules'))),digest(dependencies));
  await verifyInstalled(build,creative);await verifySource(build,pins.harness);await verifySource(harness,pins.harness);await verifySource(creative,pins.creative);
}catch(error){receipt.failure={stage,code:error.code??error.name};}
finally{
  if(controlsStarted){try{confirmed=confirmed&&JSON.parse(await readFile(join(output,'controls/lifecycle.json'))).confirmed===true;}catch{confirmed=false;}}
  receipt.cleanup=privateRoot?await retirePrivate(privateRoot,confirmed):{confirmed:true,private_removed:true};await save('cleanup.json',receipt.cleanup);
  if(!receipt.failure){receipt.status='passed';try{validateReceipt(receipt,pins);}catch(error){receipt.status='failed';receipt.failure={stage:'receipt',code:error.code??error.name};}}
  await save('receipt.json',receipt);await save('artifact-manifest.json',await manifest(output));
}
console.log(JSON.stringify({status:receipt.status,stage:receipt.failure?.stage??'complete'}));process.exitCode=receipt.status==='passed'?0:1;
