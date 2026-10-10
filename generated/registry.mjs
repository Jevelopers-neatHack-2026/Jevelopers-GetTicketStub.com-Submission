const records = {
  "CommonEnvelope": {
    "1.0.0": "CommonEnvelope_1_0_0"
  },
  "EvidenceProjection": {
    "1.0.0": "EvidenceProjection_1_0_0"
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
  "ExactDecimal": "PrimitiveExactDecimal"
});
