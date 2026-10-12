import { validateContract,checkTrustedContext,hashManifest,hashBytes,canonicalJson } from './runtime.mjs';
import { checkProductionRequest,productionRequests,productionReferences,checkProductionError,checkTemplateSpec,checkComposition,checkPersonalizationSchema,checkRowResult,checkBatchResult,checkProductionFile,checkProductionBundleV2,verifyProductionBundleFiles,productionContentHash } from './production-operations.mjs';
import { productionIssue } from './production-errors.mjs';
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export function checkProductionFixture(contract,input,context){
  const parsed=validateContract(contract,input);if(!parsed.ok)return parsed;
  const operation=Object.entries(productionRequests).find(([,name])=>name===contract)?.[0];
  if(operation)return checkProductionRequest(operation,input,{scope:context.scope,policy_version:'1.0.0',references:Object.fromEntries(productionReferences(context.expected))});
  switch(contract){
    case 'ProductionError':return checkProductionError(input,context.scope);
    case 'TemplateSpec':return checkTemplateSpec(input,context.scope);
    case 'PersonalizationSchema':return checkPersonalizationSchema(input,context.template);
    case 'Composition':return checkComposition(input,{scope:context.scope,template:context.template,personalization:context.personalization,facts:context.facts,expected_references:Object.fromEntries(productionReferences(context.expected)),expected_resolved_layout_commitment:context.expected.resolved_layout_commitment,expected_policy_refs:context.expected.policy_refs,expected_font_refs:context.expected.font_refs,expected_runtime_ref:context.expected.runtime_ref,asset_bytes:Object.fromEntries(Object.entries(context.asset_bytes).map(([id,bytes])=>[id,Buffer.from(bytes,'base64')]))});
    case 'RowResult':return checkRowResult(input,{scope:context.scope,job:context.job,original_rows:context.rows});
    case 'BatchResult':return checkBatchResult(input,{scope:context.scope,job:context.job,original_rows:context.rows});
    case 'ArtifactFile':return checkProductionFile(input);
    case 'ProductionBundle':return checkProductionBundleV2(input,context.scope);
    case 'ProductionBundleDetached':case 'ProductionBundleRef':{
      const files=Object.entries(context.byte_files).map(([filename,bytes])=>({filename,bytes:Buffer.from(bytes,'base64')}));
      const checked=verifyProductionBundleFiles(files,{scope:context.scope,trusted_commitment:context.trusted_commitment});if(!checked.ok)return checked;
      if(contract==='ProductionBundleDetached'&&!same(input,checked.value.detached))return productionIssue('HASH_MISMATCH');
      if(contract==='ProductionBundleRef'&&(!same(input.bundle_ref,context.trusted_commitment.bundle_ref)||!same(input.file_set,context.trusted_commitment.file_set)))return productionIssue('HASH_MISMATCH');
      return parsed;
    }
    case 'PreflightReport':return input.report_ref.content_hash===hashManifest(input.body)&&same(input.body.artifact_ref,context.expected.body.artifact_ref)?parsed:productionIssue('HASH_MISMATCH');
    case 'ProductionResource':case 'ProductionRuntime':case 'ProductionPolicy':case 'ProductionDiagnostic':case 'CsvDialect':case 'CsvMapping':{
      if(!checkTrustedContext(input,context.scope).ok)return productionIssue('NOT_FOUND');
      return productionContentHash(input)===input.content_hash?parsed:productionIssue('HASH_MISMATCH');
    }
    case 'JobRef':{
      const {request_id,correlation_id,idempotency_key,...semantic}=context.request;semantic.acceptance_policy=context.request.acceptance_policy??'atomic';
      return same(input.job_ref,context.expected.job_ref)&&input.batch_input_hash===hashManifest({operation:'personalizeArtifactBatch',input:semantic,pins:context.pins})?parsed:productionIssue('HASH_MISMATCH');
    }
    case 'ArtifactRef':return input.composition_ref.content_hash===context.composition.content_hash&&input.render_hash===hashBytes(Buffer.from(context.render_bytes,'base64'))&&input.private_revision_hash===hashManifest({compositionHash:context.composition.content_hash,renderHash:input.render_hash})?parsed:productionIssue('HASH_MISMATCH');
    case 'ArtifactManifestStatus':{
      if(!same(input.target,context.expected.target))return productionIssue('NOT_FOUND');
      return input.batch===null?parsed:checkBatchResult(input.batch,{scope:context.scope,job:context.job,original_rows:context.rows}).ok?parsed:productionIssue('ROW_BINDING_MISMATCH');
    }
    case 'CsvCheckpoint':return same(input,context.expected)&&input.complete_record?parsed:productionIssue('INVALID_CHECKPOINT');
    case 'ProductionReference':return same(input.reference,context.expected.reference)?parsed:productionIssue('HASH_MISMATCH');
    case 'ProductionExecutionPins':return checkTrustedContext(input,context.scope).ok&&same(input,context.expected)?parsed:productionIssue('POLICY_MISMATCH');
    case 'CompatibilityReport':return ['source_template_ref','target_template_ref','spec_ref','capability_ref'].every(key=>same(input[key],context.expected[key]))?parsed:productionIssue('HASH_MISMATCH');
    default:return productionIssue('UNSUPPORTED_VERSION');
  }
}
