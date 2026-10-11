import { validateContract, checkTrustedContext, checkCommerceEvidence, projectEvaluationEvidence } from '../generated/index.js';
import type { TrustedContext, ApprovalContext, HandoffContext, ProductionContext, AuthorizationContext, EvidenceContext, ArtifactConsumptionReceipt, ApprovalReceipt } from '../generated/index.js';
export function approval(input: unknown, server: ApprovalContext) { return checkCommerceEvidence('ApprovalReceipt', input, server); }
export function exactHandoff(input: unknown, server: HandoffContext) { return checkCommerceEvidence('ArtifactHandoffManifest', input, server); }
export function printBundle(input: unknown, server: ProductionContext) { return checkCommerceEvidence('ProductionBundle', input, server); }
export function purchaseTerms(input: unknown, server: AuthorizationContext) { return checkCommerceEvidence('OrderAuthorization', input, server); }
export function publicEvidence(input: unknown, server: EvidenceContext) { return projectEvaluationEvidence(input, server); }
export function scope(input: unknown, server: TrustedContext): ApprovalReceipt | undefined {
  const parsed = validateContract('ApprovalReceipt', input); if (!parsed.ok) return undefined;
  const checked = checkTrustedContext(parsed.value, server); return checked.ok ? checked.value : undefined;
}
export type ReceiptKindsAreDistinct = ArtifactConsumptionReceipt['contract'] extends ApprovalReceipt['contract'] ? false : true;
