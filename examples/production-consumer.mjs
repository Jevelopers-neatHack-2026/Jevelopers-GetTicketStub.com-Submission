import { readFile } from 'node:fs/promises';
import { runCanonicalFixtures } from '@jevelopers/shared-contracts/fixture-harness';
import { verifyProductionBundleFiles, checkTemplateSpec, checkPersonalizationPlan } from '@jevelopers/shared-contracts/production-operations';
const read = async name => JSON.parse(await readFile(new URL(import.meta.resolve('@jevelopers/shared-contracts/fixtures/'+name+'.json')), 'utf8'));
const names=['ComposeArtifactRequest','PersonalizeBatchRequest','InspectArtifactRequest','ExportBundleRequest','CompareTemplateRequest','ArtifactStatusRequest','ProductionError','TemplateSpec','Composition','PersonalizationSchema','RowResult','BatchResult','ArtifactFile.2_0_0','ProductionBundle.2_0_0','ProductionBundleDetached'];
let cases=0;
for(const name of names){const fixture=await read(name),result=runCanonicalFixtures(fixture.contract,fixture);if(result.failures.length)throw new Error('Installed production fixture rejected');cases+=result.records.length;}
const calibration=await read('ProductionCalibration');
const files=Object.entries(calibration.byte_files).map(([filename,value])=>({filename,bytes:Buffer.from(value,'base64')}));
const result=verifyProductionBundleFiles(files,{scope:calibration.scope,trusted_commitment:calibration.trusted_commitment});
if(!result.ok||result.value.integrity!=='passed'||result.value.eligibility!=='blocked')throw new Error('Calibration boundary changed');
if(!checkTemplateSpec(calibration.template,calibration.scope).ok||!checkPersonalizationPlan((await read('PersonalizeBatchRequest')).valid,{scope:calibration.scope,policy:calibration.personalization,template:calibration.template}).ok)throw new Error('Installed values rejected');
console.log(JSON.stringify({module:'production-operations',fixture_cases:cases,integrity:'passed',eligibility:'blocked',accepted:false}));
