import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { executeScenarios } from './scenarios.mjs';
import { validateArtifacts, validateVariant, validateBoundary } from './receipt.mjs';

const source=process.env.FC_BUILT_SOURCE;const corpus=process.env.FC_CORPUS;const output=process.env.FC_BUNDLE_EVIDENCE;
assert.ok(source&&corpus&&output,'direct fixture tests require explicit built source, extracted immutable corpus and new evidence directory');
const pin=JSON.parse(await readFile(new URL('../contracts/fulfillment-producer-pin.json',import.meta.url)));
await mkdir(output,{mode:0o700});
await executeScenarios(source,{corpus,output,pin});
test('seven actual variant reports and three boundary artifacts qualify without authority',async()=>{
  const artifacts=await validateArtifacts(output,pin);assert.equal(artifacts.length,10);
});
test('real returned report rejects changed input hash',async()=>{
  const value=JSON.parse(await readFile(join(output,'variant-valid.json')));value.report.inputDigests['output.png']='sha256:'+'0'.repeat(64);
  assert.throws(()=>validateVariant(value,pin));
});
test('real denial rejects a nonzero simulated transport delta',async()=>{
  const value=JSON.parse(await readFile(join(output,'boundary-use-time-drift.json')));value.counters_delta.transport=1;
  assert.throws(()=>validateBoundary(value,pin));
});
test('forged sandbox-labeled denial rejects a missing zero-counter dimension',async()=>{
  const value=JSON.parse(await readFile(join(output,'boundary-non-simulated-denial.json')));delete value.counters_after.budget;
  assert.throws(()=>validateBoundary(value,pin));
});
