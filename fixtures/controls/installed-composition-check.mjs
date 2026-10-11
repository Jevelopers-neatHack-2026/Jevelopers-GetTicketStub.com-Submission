/** Fresh offline tarball consumer. Only declared host/transport fixtures are
 * copied; every controls/API/store module resolves from the installed package. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, delimiter, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2),index=args.indexOf('--evidence-dir');
if(index<0||!args[index+1])throw Error('Usage: installed-composition-check.mjs --evidence-dir <new-directory>');
const evidence=resolve(root,args[index+1]),temporary=mkdtempSync(join(tmpdir(),'controls-installed-composition-')),consumer=join(temporary,'consumer'),records=[];
mkdirSync(evidence,{recursive:true});mkdirSync(consumer);
const env={...process.env,PATH:`${dirname(process.execPath)}${delimiter}${process.env.PATH??''}`,CONTROLS_COMPOSITION_EVIDENCE_DIR:join(evidence,'store-artifacts')};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function run(command,argv,cwd){const started_at=new Date().toISOString(),result=spawnSync(command,argv,{cwd,env,encoding:'buffer',maxBuffer:32*1024*1024});const n=records.length+1;
  writeFileSync(join(evidence,`${n}.stdout.raw`),result.stdout??Buffer.alloc(0));writeFileSync(join(evidence,`${n}.stderr.raw`),result.stderr??Buffer.alloc(0));
  records.push({command,argv,cwd,started_at,finished_at:new Date().toISOString(),node:process.version,node_executable:process.execPath,PATH:env.PATH,exit_code:result.status,stdout_sha256:digest(result.stdout??''),stderr_sha256:digest(result.stderr??'')});
  writeFileSync(join(evidence,'commands.json'),JSON.stringify(records,null,2)+'\n');process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0,JSON.stringify(records.at(-1)));return result.stdout.toString();}
function inventory(directory,prefix=''){return readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{const path=join(directory,entry.name),relative=prefix?`${prefix}/${entry.name}`:entry.name;
  if(entry.isDirectory())return entry.name==='node_modules'?[]:inventory(path,relative);assert.equal(entry.isSymbolicLink(),false,'installed package source must not alias checkout');const bytes=readFileSync(path);return[{path:relative,bytes:bytes.length,sha256:digest(bytes)}];});}
try {
  writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'offline-composition-controls-consumer',version:'1.0.0',private:true,type:'module'}));
  const pack=JSON.parse(run('npm',['pack','--json','--pack-destination',temporary],root))[0],tarball=join(temporary,pack.filename);cpSync(tarball,join(evidence,pack.filename));
  run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--no-save',tarball],consumer);
  const installed=join(consumer,'node_modules/creative-engine');run('npm',['ci','--offline','--ignore-scripts','--no-audit','--no-fund'],join(installed,'src/models/codec-runtime'));
  const files=['fixtures/controls/integrated-host.mjs','fixtures/controls/native-image-ports.mjs','fixtures/controls/offline-inspection-ports.mjs','fixtures/controls/offline-composition-ports.mjs','fixtures/controls/composition-policy.mjs','fixtures/controls/composition-restart-worker.mjs',
    'fixtures/planning/research-packages.mjs','fixtures/contracts/creative/current.json','fixtures/models/png.mjs','fixtures/models/valid-16x16.jpg','fixtures/models/valid-16x16.webp','tests/controls/composition-integration.test.mjs','tests/controls/types/composition-consumer.mts'];
  for(const file of files){const destination=join(consumer,file);mkdirSync(dirname(destination),{recursive:true});cpSync(join(root,file),destination);
    if(file.endsWith('.mjs')||file.endsWith('.mts')){const source=readFileSync(destination,'utf8').replaceAll(/'\.\.\/(?:\.\.\/){1,2}src\/controls\/[a-z-]+\.mjs'/g,"'creative-engine/controls'");writeFileSync(destination,source);}}
  cpSync(join(consumer,'fixtures'),join(evidence,'consumer-fixtures'),{recursive:true});cpSync(join(consumer,'tests'),join(evidence,'consumer-tests'),{recursive:true});
  const installedInventory=inventory(installed);writeFileSync(join(evidence,'installed-source-manifest.json'),JSON.stringify(installedInventory,null,2)+'\n');
  run(process.execPath,['--input-type=module','-e',"import assert from 'node:assert/strict';import {CompositionControlsAdapter,COMPOSITION_APPLY_VERSION,assertCompositionCurrent} from 'creative-engine/controls';assert.equal(typeof CompositionControlsAdapter,'function');assert.equal(COMPOSITION_APPLY_VERSION,'creative-composition-apply/1.0');assert.throws(()=>assertCompositionCurrent({script:'run'}));console.log(import.meta.resolve('creative-engine/controls'));"],consumer);
  run(process.execPath,[join(root,'examples/frontend-action-roundtrip/node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','false','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','tests/controls/types/composition-consumer.mts'],consumer);
  run(process.execPath,['--test','--test-reporter=tap','tests/controls/composition-integration.test.mjs'],consumer);
  writeFileSync(join(evidence,'result.json'),JSON.stringify({status:'passed',mode:'mock',live_calls:0,tarball_sha256:digest(readFileSync(tarball)),installed,source_aliases:false,installed_source_files:installedInventory.length,records},null,2)+'\n');
} finally { rmSync(temporary,{recursive:true,force:true}); }
