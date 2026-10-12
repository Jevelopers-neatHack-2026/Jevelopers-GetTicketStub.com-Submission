import { readFile } from 'node:fs/promises';
import { hashManifest } from '../tooling/runtime.mjs';
import { productionReferences } from '../tooling/production-operations.mjs';
export const readProduction = async name => JSON.parse(await readFile(new URL('../fixtures/' + name + '.json', import.meta.url), 'utf8')).valid;
export const calibration = JSON.parse(await readFile(new URL('../fixtures/ProductionCalibration.json', import.meta.url), 'utf8'));
export const clone = value => structuredClone(value);
export function compositionContext() {
  const d = clone(calibration);
  return { scope:d.scope,template:d.template,personalization:d.personalization,facts:d.facts,expected_references:Object.fromEntries(productionReferences(d.composition)),expected_resolved_layout_commitment:d.composition.resolved_layout_commitment,expected_policy_refs:d.composition.policy_refs,expected_font_refs:d.composition.font_refs,expected_runtime_ref:d.composition.runtime_ref,asset_bytes:Object.fromEntries(Object.entries(d.asset_bytes).map(([id,bytes])=>[id,Buffer.from(bytes,'base64')])) };
}
export function byteContext() {
  return { scope:clone(calibration.scope),trusted_commitment:clone(calibration.trusted_commitment) };
}
export function observedFiles() {
  return Object.entries(calibration.byte_files).map(([filename,bytes])=>({filename,bytes:Buffer.from(bytes,'base64')}));
}
export function batchContext() {
  return { scope:clone(calibration.scope),job:clone(calibration.batch.job),original_rows:clone(calibration.rows),verified_rows:{} };
}
export function partialBatch() {
  const context = batchContext(), batch = clone(calibration.batch);
  batch.acceptance_policy='allow_partial';batch.status='partially_succeeded';batch.published_count=1;
  batch.job.batch_input_hash=hashManifest({ synthetic_plan:calibration.rows,acceptance_policy:'allow_partial',pins:calibration.pins });context.job=clone(batch.job);
  for(const row of batch.rows)row.job=clone(batch.job);
  const row=batch.rows[0],bundle=clone(calibration.trusted_commitment);
  bundle.row_scope={job_ref:clone(batch.job),row_id:row.row_id,ordinal:row.ordinal,input_hash:row.input_hash};
  bundle.bundle_ref.id='123e4567-e89b-42d3-a456-000000000201';bundle.bundle_ref.content_hash=hashManifest({synthetic_row_protocol:bundle.row_scope});
  row.bundle_ref=bundle;
  const artifact={contract:'ArtifactRef',schema_version:'1.0.0',policy_version:'1.0.0',artifact_ref:clone(calibration.composition.asset_uses[0].asset_ref),composition_ref:clone(bundle.composition_ref),private_revision_hash:hashManifest({synthetic_row:row.row_id}),source_artwork_hashes:[calibration.composition.asset_uses[0].asset_ref.content_hash],render_hash:calibration.composition.asset_uses[0].asset_ref.content_hash,preview_ref:clone(calibration.composition.asset_uses[0].asset_ref)};
  row.artifact_ref=artifact;row.eligibility={state:'eligible',reason_codes:[],checked_at:calibration.now,evidence_mode:'simulated',handoff_eligible:false};
  context.verified_rows[row.row_id]={artifact_ref:clone(artifact),bundle_ref:clone(bundle),preflight_status:'passed',input_hash:row.input_hash,ordinal:row.ordinal,job:clone(batch.job)};
  return {batch,context,evidence_mode:'synthetic_independent_row_metadata_only',genuine_personalized_bytes:false};
}
