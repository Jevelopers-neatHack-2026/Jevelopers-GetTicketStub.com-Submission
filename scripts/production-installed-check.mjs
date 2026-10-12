import { cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './generate.mjs';

export async function productionInstalledChecks(directory, run) {
  await cp(root+'examples/production-consumer.mjs',join(directory,'production-consumer.mjs'));
  console.log(run(process.execPath,['production-consumer.mjs'],directory).trim());
  await cp(root+'tests/production-operations-types.ts',join(directory,'production-types.mts'));
  const args=[root+'node_modules/typescript/bin/tsc','--noEmit','--strict','--skipLibCheck','false','--module','NodeNext','--moduleResolution','NodeNext'];
  run(process.execPath,[...args,join(directory,'production-types.mts')],directory);
  const negatives={readonly_facts:"import type { Composition } from '@jevelopers/shared-contracts'; declare const value: Composition; value.fact_bindings.push({slot_id:'x',fact_key:'title',value_hash:'x'});",readonly_nested:"import type { Composition } from '@jevelopers/shared-contracts'; declare const value: Composition; value.fact_bindings[0].value_hash='x';",context_collision:"import type { ProductionContext as Old } from '@jevelopers/shared-contracts/commerce-evidence'; import type { ProductionContext } from '@jevelopers/shared-contracts/production-operations'; declare const old: Old; const host: ProductionContext = old;",unsupported_reference:"import type { ProductionReferenceValue } from '@jevelopers/shared-contracts/production-operations'; declare const ref: ProductionReferenceValue; const version: '9.0.0' = ref.schema_version;",unknown_result:"import type { ProductionResult, ArtifactRef } from '@jevelopers/shared-contracts/production-operations'; const result: ProductionResult<ArtifactRef> = {ok:false, errors:[]};"};
  Object.assign(negatives, {
    missing_host_authority: "import type { ProductionContext } from '@jevelopers/shared-contracts/production-operations'; declare const unbound: Omit<ProductionContext, 'authority'>; const host: ProductionContext = unbound;",
    missing_host_actor: "import type { ProductionHostAuthority } from '@jevelopers/shared-contracts/production-operations'; const authority: ProductionHostAuthority = {audience:'print-production'};",
    missing_host_audience: "import type { ProductionHostAuthority } from '@jevelopers/shared-contracts/production-operations'; const authority: ProductionHostAuthority = {actor_id:'host_actor'};",
    unsupported_host_audience: "import type { ProductionHostAuthority } from '@jevelopers/shared-contracts/production-operations'; const authority: ProductionHostAuthority = {actor_id:'host_actor',audience:'unregistered-service'};",
    readonly_host_actor: "import type { ProductionContext } from '@jevelopers/shared-contracts/production-operations'; declare const host: ProductionContext; host.authority.actor_id='another_actor';",
    readonly_host_audience: "import type { ProductionContext } from '@jevelopers/shared-contracts/production-operations'; declare const host: ProductionContext; host.authority.audience='event-intelligence';"
  });
  for(const [name,source] of Object.entries(negatives)){
    const file=join(directory,name+'.mts');await writeFile(file,source+'\n');
    const result=spawnSync(process.execPath,[...args,file],{cwd:directory,encoding:'utf8',maxBuffer:1048576});
    if(result.error)throw result.error;
    if(result.status===0||!result.stdout.includes('error TS'))throw new Error('Invalid installed production type was accepted: '+name);
  }
  console.log(JSON.stringify({production_signatures:6,contexts:2,negative_types:Object.keys(negatives).length,status:'passed'}));
}
