/*
 * EI-only validator adapter. The upstream generated validator bundle is a
 * broad cross-cut artifact; this adapter compiles only the pinned raw schemas
 * in this fixture snapshot with the pinned test-only Ajv dependency. It does
 * not alter the source schemas or candidate helper semantics.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import CommonEnvelope from '../schemas/CommonEnvelope/1.0.0.json' with { type: 'json' };
import ErrorEnvelope from '../schemas/ErrorEnvelope/1.0.0.json' with { type: 'json' };
import ResearchRequest from '../schemas/ResearchRequest/1.0.0.json' with { type: 'json' };
import EventIntelligencePackage from '../schemas/EventIntelligencePackage/1.0.0.json' with { type: 'json' };
import DecisionPortRequest from '../schemas/DecisionPortRequest/1.0.0.json' with { type: 'json' };
import DecisionPortResult from '../schemas/DecisionPortResult/1.0.0.json' with { type: 'json' };
import ResearchRequestReceipt from '../schemas/ResearchRequestReceipt/1.0.0.json' with { type: 'json' };
import ResearchAnswerReceipt from '../schemas/ResearchAnswerReceipt/1.0.0.json' with { type: 'json' };
import ResearchBatchReceipt from '../schemas/ResearchBatchReceipt/1.0.0.json' with { type: 'json' };
import ResearchCorrectionRequest from '../schemas/ResearchCorrectionRequest/1.0.0.json' with { type: 'json' };
import ResearchCorrectionReceipt from '../schemas/ResearchCorrectionReceipt/1.0.0.json' with { type: 'json' };
import ResearchInvalidation from '../schemas/ResearchInvalidation/1.0.0.json' with { type: 'json' };
import BudgetReservationV1 from '../schemas/BudgetReservation/1.0.0.json' with { type: 'json' };
import BudgetReservationV2 from '../schemas/BudgetReservation/2.0.0.json' with { type: 'json' };
import ReserveRequestV2 from '../schemas/ReserveRequest/2.0.0.json' with { type: 'json' };

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  inlineRefs: false,
  ownProperties: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  code: { source: true, esm: true, formats: false }
});
ajv.addKeyword({ keyword: 'x-classification', schemaType: 'string' });
ajv.addKeyword({ keyword: 'tsType', schemaType: 'string' });
ajv.addFormat('uuid', /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
// Exact format validators and compiler options from the pinned candidate's
// scripts/generate.mjs (source pin recorded in audit-inputs/source-pins.json).
ajv.addFormat('utc-time', /^(?:(?:[0-9]{4})-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))|(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29)T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{3})?Z$/);
const schemaDocuments = [
  CommonEnvelope,
  ErrorEnvelope,
  ResearchRequest,
  EventIntelligencePackage,
  DecisionPortRequest,
  DecisionPortResult,
  ResearchRequestReceipt,
  ResearchAnswerReceipt,
  ResearchBatchReceipt,
  ResearchCorrectionRequest,
  ResearchCorrectionReceipt,
  ResearchInvalidation,
  BudgetReservationV1,
  BudgetReservationV2,
  ReserveRequestV2
];

for (const schema of schemaDocuments) ajv.addSchema(schema);

function schemaValidator(schema) {
  const validator = ajv.getSchema(schema.$id);
  if (!validator) throw new Error(`Pinned schema was not compiled: ${schema.$id}`);
  return validator;
}

function definitionValidator(schema, name) {
  const validator = ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` });
  return validator;
}

export const CommonEnvelope_1_0_0 = schemaValidator(CommonEnvelope);
export const ErrorEnvelope_1_0_0 = schemaValidator(ErrorEnvelope);
export const ResearchRequest_1_0_0 = schemaValidator(ResearchRequest);
export const EventIntelligencePackage_1_0_0 = schemaValidator(EventIntelligencePackage);
export const DecisionPortRequest_1_0_0 = schemaValidator(DecisionPortRequest);
export const DecisionPortResult_1_0_0 = schemaValidator(DecisionPortResult);
export const ResearchRequestReceipt_1_0_0 = schemaValidator(ResearchRequestReceipt);
export const ResearchAnswerReceipt_1_0_0 = schemaValidator(ResearchAnswerReceipt);
export const ResearchBatchReceipt_1_0_0 = schemaValidator(ResearchBatchReceipt);
export const ResearchCorrectionRequest_1_0_0 = schemaValidator(ResearchCorrectionRequest);
export const ResearchCorrectionReceipt_1_0_0 = schemaValidator(ResearchCorrectionReceipt);
export const ResearchInvalidation_1_0_0 = schemaValidator(ResearchInvalidation);
export const BudgetReservation_1_0_0 = schemaValidator(BudgetReservationV1);
export const BudgetReservation_2_0_0 = schemaValidator(BudgetReservationV2);
export const ReserveRequest_2_0_0 = schemaValidator(ReserveRequestV2);

export const DefinitionVersionedReference = definitionValidator(ErrorEnvelope, 'VersionedReference');
export const DefinitionDecisionQuestion = ajv.compile({ $ref: `${DecisionPortRequest.$id}#/properties/questions/additionalProperties` });

export const PrimitiveTenantId = definitionValidator(CommonEnvelope, 'TenantId');
export const PrimitiveProjectId = definitionValidator(CommonEnvelope, 'ProjectId');
export const PrimitiveEventId = definitionValidator(CommonEnvelope, 'EventId');
export const PrimitiveWorkflowId = definitionValidator(CommonEnvelope, 'WorkflowId');
export const PrimitiveRunId = definitionValidator(CommonEnvelope, 'RunId');
export const PrimitiveJobId = definitionValidator(CommonEnvelope, 'JobId');
export const PrimitiveArtifactId = definitionValidator(CommonEnvelope, 'ArtifactId');
export const PrimitiveDesignId = definitionValidator(CommonEnvelope, 'DesignId');
export const PrimitiveDesignVersionId = definitionValidator(CommonEnvelope, 'DesignVersionId');
export const PrimitiveOrderId = definitionValidator(CommonEnvelope, 'OrderId');
export const PrimitiveTraceId = definitionValidator(CommonEnvelope, 'TraceId');
export const PrimitiveCorrelationId = definitionValidator(CommonEnvelope, 'CorrelationId');
export const PrimitiveEvidenceId = definitionValidator(CommonEnvelope, 'EvidenceId');
export const PrimitiveUsageEventId = definitionValidator(CommonEnvelope, 'UsageEventId');
export const PrimitiveLogicalOperationId = definitionValidator(CommonEnvelope, 'LogicalOperationId');
export const PrimitiveProviderAttemptId = definitionValidator(CommonEnvelope, 'ProviderAttemptId');
export const PrimitiveBillableAttemptId = definitionValidator(CommonEnvelope, 'BillableAttemptId');
export const PrimitiveTransportAttemptId = definitionValidator(CommonEnvelope, 'TransportAttemptId');
export const PrimitiveProviderRequestId = definitionValidator(CommonEnvelope, 'ProviderRequestId');
export const PrimitiveSourceRevision = definitionValidator(CommonEnvelope, 'SourceRevision');
export const PrimitiveUtcTime = definitionValidator(CommonEnvelope, 'UtcTime');
export const PrimitiveSha256 = definitionValidator(CommonEnvelope, 'Sha256');
export const PrimitiveExactDecimal = definitionValidator(CommonEnvelope, 'ExactDecimal');
export const PrimitiveRequestId = definitionValidator(ErrorEnvelope, 'RequestId');
export const PrimitiveBatchId = definitionValidator(ErrorEnvelope, 'BatchId');
export const PrimitiveReservationId = definitionValidator(ErrorEnvelope, 'ReservationId');
export const PrimitiveBudgetScopeId = definitionValidator(ErrorEnvelope, 'BudgetScopeId');
export const PrimitiveSourceObservationId = definitionValidator(ErrorEnvelope, 'SourceObservationId');
export const PrimitiveLeaseAttemptId = definitionValidator(ErrorEnvelope, 'LeaseAttemptId');
export const PrimitiveQuestionKey = definitionValidator(ErrorEnvelope, 'QuestionKey');
export const PrimitiveCurrency = definitionValidator(ErrorEnvelope, 'Currency');
export const PrimitiveRevision = definitionValidator(ErrorEnvelope, 'Revision');
export const PrimitiveSignedDecimal = definitionValidator(ErrorEnvelope, 'SignedDecimal');
export const PrimitivePackageId = definitionValidator(EventIntelligencePackage, 'PackageId');
export const PrimitiveFactId = definitionValidator(EventIntelligencePackage, 'FactId');
export const PrimitiveAssetId = definitionValidator(EventIntelligencePackage, 'AssetId');
export const PrimitiveBriefId = definitionValidator(EventIntelligencePackage, 'BriefId');
