import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../tooling/runtime.mjs';
import { parseProductionCanonicalBytes, productionJsonLimits, productionArchiveLimits } from '../tooling/production-operations.mjs';
import { readProduction } from './production-seeds.mjs';
for (const [contract, version, maximum, fixture] of [['ProductionBundle','2.0.0',productionArchiveLimits.manifest_bytes,'ProductionBundle.2_0_0'],['ProductionBundleDetached','1.0.0',productionArchiveLimits.detached_bytes,'ProductionBundleDetached']]) {
  const original = canonicalJson(await readProduction(fixture));
  test(contract + ' accepts ordinary canonical bytes within the work budget', () => assert.equal(parseProductionCanonicalBytes(contract,version,Buffer.from(original),maximum).ok,true));
  for (const depth of [10, productionJsonLimits.maximum_depth, productionJsonLimits.maximum_depth + 1, 5000]) test(contract + ' returns a typed failure at depth ' + depth, () => {
    const raw = original.replace(/}$/, ',"unexpected":' + '['.repeat(depth - 1) + '0' + ']'.repeat(depth - 1) + '}');
    const result = parseProductionCanonicalBytes(contract,version,Buffer.from(raw),maximum);
    assert.equal(result.ok,false);
    assert.equal(result.errors[0].code,depth > productionJsonLimits.maximum_depth?'RESOURCE_LIMIT':'INTEGRITY_FAILURE');
  });
  for (const over of [false,true]) test(contract + ' bounds token work ' + (over?'above':'at') + ' the ceiling', () => {
    const raw = '[' + Array(49998).fill('0').join(',') + ',[' + (over?'0':'') + ']]';
    const result = parseProductionCanonicalBytes(contract,version,Buffer.from(raw),maximum);
    assert.equal(result.ok,false);
    assert.equal(result.errors[0].code,over?'RESOURCE_LIMIT':'INTEGRITY_FAILURE');
  });
  test(contract + ' does not count brackets or escaped quotes inside string tokens as nesting', () => {
    const raw = original.replace(/}$/, ',"unexpected":' + JSON.stringify('['.repeat(5000) + '\\"' + ']'.repeat(5000)) + '}');
    assert.equal(parseProductionCanonicalBytes(contract,version,Buffer.from(raw),maximum).errors[0].code,'INTEGRITY_FAILURE');
  });
}
