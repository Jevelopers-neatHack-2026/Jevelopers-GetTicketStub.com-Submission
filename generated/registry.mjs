const records = {
  "ApprovalReceipt": {
    "1.0.0": "ApprovalReceipt_1_0_0"
  },
  "ApprovalReference": {
    "1.0.0": "ApprovalReference_1_0_0"
  },
  "ApprovalVerificationOutcome": {
    "1.0.0": "ApprovalVerificationOutcome_1_0_0"
  },
  "ApprovalVerificationRequest": {
    "1.0.0": "ApprovalVerificationRequest_1_0_0"
  },
  "ArtifactConsumptionReceipt": {
    "1.0.0": "ArtifactConsumptionReceipt_1_0_0"
  },
  "ArtifactHandoffManifest": {
    "1.0.0": "ArtifactHandoffManifest_1_0_0"
  },
  "BudgetReservation": {
    "1.0.0": "BudgetReservation_1_0_0",
    "2.0.0": "BudgetReservation_2_0_0"
  },
  "Cancellation": {
    "1.0.0": "Cancellation_1_0_0"
  },
  "CommonEnvelope": {
    "1.0.0": "CommonEnvelope_1_0_0"
  },
  "CreativeBrief": {
    "1.0.0": "CreativeBrief_1_0_0"
  },
  "DecisionPortRequest": {
    "1.0.0": "DecisionPortRequest_1_0_0"
  },
  "DecisionPortResult": {
    "1.0.0": "DecisionPortResult_1_0_0"
  },
  "DecisionReceipt": {
    "1.0.0": "DecisionReceipt_1_0_0"
  },
  "DesignControlSchema": {
    "1.0.0": "DesignControlSchema_1_0_0"
  },
  "DesignVersion": {
    "1.0.0": "DesignVersion_1_0_0"
  },
  "ErrorEnvelope": {
    "1.0.0": "ErrorEnvelope_1_0_0"
  },
  "EvaluationEvidence": {
    "1.0.0": "EvaluationEvidence_1_0_0"
  },
  "EventIntelligencePackage": {
    "1.0.0": "EventIntelligencePackage_1_0_0"
  },
  "EvidenceProjection": {
    "1.0.0": "EvidenceProjection_1_0_0"
  },
  "FinancialSummary": {
    "1.0.0": "FinancialSummary_1_0_0"
  },
  "FulfillmentQuote": {
    "1.0.0": "FulfillmentQuote_1_0_0"
  },
  "FulfillmentStatus": {
    "1.0.0": "FulfillmentStatus_1_0_0"
  },
  "JobCommandAcknowledgement": {
    "1.0.0": "JobCommandAcknowledgement_1_0_0"
  },
  "JobProgress": {
    "1.0.0": "JobProgress_1_0_0"
  },
  "JobStatus": {
    "1.0.0": "JobStatus_1_0_0"
  },
  "OrderAuthorization": {
    "1.0.0": "OrderAuthorization_1_0_0"
  },
  "PartialFailure": {
    "1.0.0": "PartialFailure_1_0_0"
  },
  "ProductionBundle": {
    "1.0.0": "ProductionBundle_1_0_0"
  },
  "ProjectRequest": {
    "1.0.0": "ProjectRequest_1_0_0"
  },
  "QueryRequest": {
    "1.0.0": "QueryRequest_1_0_0",
    "2.0.0": "QueryRequest_2_0_0"
  },
  "QueryResult": {
    "1.0.0": "QueryResult_1_0_0",
    "2.0.0": "QueryResult_2_0_0"
  },
  "ReleaseRequest": {
    "1.0.0": "ReleaseRequest_1_0_0",
    "2.0.0": "ReleaseRequest_2_0_0"
  },
  "ReleaseResult": {
    "1.0.0": "ReleaseResult_1_0_0",
    "2.0.0": "ReleaseResult_2_0_0"
  },
  "ResearchAnswerReceipt": {
    "1.0.0": "ResearchAnswerReceipt_1_0_0"
  },
  "ResearchBatchReceipt": {
    "1.0.0": "ResearchBatchReceipt_1_0_0"
  },
  "ResearchCorrectionReceipt": {
    "1.0.0": "ResearchCorrectionReceipt_1_0_0"
  },
  "ResearchCorrectionRequest": {
    "1.0.0": "ResearchCorrectionRequest_1_0_0"
  },
  "ResearchInvalidation": {
    "1.0.0": "ResearchInvalidation_1_0_0"
  },
  "ResearchRequest": {
    "1.0.0": "ResearchRequest_1_0_0"
  },
  "ResearchRequestReceipt": {
    "1.0.0": "ResearchRequestReceipt_1_0_0"
  },
  "ReserveRequest": {
    "1.0.0": "ReserveRequest_1_0_0",
    "2.0.0": "ReserveRequest_2_0_0"
  },
  "ReserveResult": {
    "1.0.0": "ReserveResult_1_0_0",
    "2.0.0": "ReserveResult_2_0_0"
  },
  "SettleRequest": {
    "1.0.0": "SettleRequest_1_0_0",
    "2.0.0": "SettleRequest_2_0_0"
  },
  "SettleResult": {
    "1.0.0": "SettleResult_1_0_0",
    "2.0.0": "SettleResult_2_0_0"
  },
  "UsageEvent": {
    "1.0.0": "UsageEvent_1_0_0"
  }
};
for (const record of Object.values(records)) Object.freeze(record);
export const versions = Object.freeze(records);
export const primitiveValidators = Object.freeze({
  "ApprovalId": "PrimitiveApprovalId",
  "TenantId": "PrimitiveTenantId",
  "ProjectId": "PrimitiveProjectId",
  "EventId": "PrimitiveEventId",
  "WorkflowId": "PrimitiveWorkflowId",
  "RunId": "PrimitiveRunId",
  "JobId": "PrimitiveJobId",
  "ArtifactId": "PrimitiveArtifactId",
  "DesignId": "PrimitiveDesignId",
  "DesignVersionId": "PrimitiveDesignVersionId",
  "OrderId": "PrimitiveOrderId",
  "TraceId": "PrimitiveTraceId",
  "CorrelationId": "PrimitiveCorrelationId",
  "EvidenceId": "PrimitiveEvidenceId",
  "UsageEventId": "PrimitiveUsageEventId",
  "LogicalOperationId": "PrimitiveLogicalOperationId",
  "ProviderAttemptId": "PrimitiveProviderAttemptId",
  "BillableAttemptId": "PrimitiveBillableAttemptId",
  "TransportAttemptId": "PrimitiveTransportAttemptId",
  "ProviderRequestId": "PrimitiveProviderRequestId",
  "SourceRevision": "PrimitiveSourceRevision",
  "UtcTime": "PrimitiveUtcTime",
  "Sha256": "PrimitiveSha256",
  "ExactDecimal": "PrimitiveExactDecimal",
  "RequestId": "PrimitiveRequestId",
  "BatchId": "PrimitiveBatchId",
  "ReservationId": "PrimitiveReservationId",
  "BudgetScopeId": "PrimitiveBudgetScopeId",
  "SourceObservationId": "PrimitiveSourceObservationId",
  "LeaseAttemptId": "PrimitiveLeaseAttemptId",
  "QuestionKey": "PrimitiveQuestionKey",
  "Currency": "PrimitiveCurrency",
  "Revision": "PrimitiveRevision",
  "SignedDecimal": "PrimitiveSignedDecimal",
  "PackageId": "PrimitivePackageId",
  "FactId": "PrimitiveFactId",
  "AssetId": "PrimitiveAssetId",
  "BriefId": "PrimitiveBriefId"
});
