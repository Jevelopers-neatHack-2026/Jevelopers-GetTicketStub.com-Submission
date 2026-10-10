const records = {
  "BudgetReservation": {
    "1.0.0": "BudgetReservation_1_0_0"
  },
  "Cancellation": {
    "1.0.0": "Cancellation_1_0_0"
  },
  "CommonEnvelope": {
    "1.0.0": "CommonEnvelope_1_0_0"
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
  "ErrorEnvelope": {
    "1.0.0": "ErrorEnvelope_1_0_0"
  },
  "EvidenceProjection": {
    "1.0.0": "EvidenceProjection_1_0_0"
  },
  "FinancialSummary": {
    "1.0.0": "FinancialSummary_1_0_0"
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
  "PartialFailure": {
    "1.0.0": "PartialFailure_1_0_0"
  },
  "QueryRequest": {
    "1.0.0": "QueryRequest_1_0_0"
  },
  "QueryResult": {
    "1.0.0": "QueryResult_1_0_0"
  },
  "ReleaseRequest": {
    "1.0.0": "ReleaseRequest_1_0_0"
  },
  "ReleaseResult": {
    "1.0.0": "ReleaseResult_1_0_0"
  },
  "ReserveRequest": {
    "1.0.0": "ReserveRequest_1_0_0"
  },
  "ReserveResult": {
    "1.0.0": "ReserveResult_1_0_0"
  },
  "SettleRequest": {
    "1.0.0": "SettleRequest_1_0_0"
  },
  "SettleResult": {
    "1.0.0": "SettleResult_1_0_0"
  },
  "UsageEvent": {
    "1.0.0": "UsageEvent_1_0_0"
  }
};
for (const record of Object.values(records)) Object.freeze(record);
export const versions = Object.freeze(records);
export const primitiveValidators = Object.freeze({
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
  "SignedDecimal": "PrimitiveSignedDecimal"
});
