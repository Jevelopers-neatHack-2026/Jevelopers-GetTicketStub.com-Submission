import { validateContract, parseContract, versions } from '@jevelopers/shared-contracts';
import type { EventIntelligencePackage, ResearchCorrectionRequest, ResearchInvalidation } from '@jevelopers/shared-contracts';
import { checkEventIntelligencePackage, adaptResearchPackage } from '@jevelopers/shared-contracts/research-creative';
import type { ResearchContext, ResearchFact } from '@jevelopers/shared-contracts/research-creative';
import { validateVersionedReference } from '@jevelopers/shared-contracts/operations';
import { bindDecisionPort, checkDecisionRequest, checkDecisionResult } from '@jevelopers/shared-contracts/operations';
import type { DecisionContext, DecisionPort, OperationCode, OperationResult } from '@jevelopers/shared-contracts/operations';
import type { DecisionPortRequest, DecisionPortResult } from '@jevelopers/shared-contracts';
import type { CorrectionHistorySnapshot, CorrectionInput, ReviewInvalidation } from '__EI_HISTORY_MODULE__';
import { prepareIdentityQuestionFromComposition } from '__EI_QUESTIONS_MODULE__';
import type { QuestionPlan } from '__EI_QUESTIONS_MODULE__';

declare const local: CorrectionHistorySnapshot;
declare const command: CorrectionInput;
declare const invalidation: ReviewInvalidation;
declare const context: ResearchContext;
const checked = checkEventIntelligencePackage(local, context);
if (checked.ok) {
  const version: '1.0.0' = checked.value.schema_version;
  const fact: ResearchFact = checked.value.facts[0];
  const ref = validateVersionedReference(checked.value.request_ref);
  void [version, fact, ref];
}
const parsed = parseContract('ResearchRequest', '{}');
const validated = validateContract('ResearchCorrectionReceipt', {});
const alias = adaptResearchPackage(local, 'canonical-alias-1.0.0');
if (alias.ok) { const migrationIsNotAccepted: false = alias.value.accepted_migration; void migrationIsNotAccepted; }
const registered: 'EventIntelligencePackage_1_0_0' = versions.EventIntelligencePackage['1.0.0'];

// Real local DTOs must not become assignable to the canonical wire contracts.
// @ts-expect-error Local snapshots omit canonical scope, references and hash domains.
const notAPackage: EventIntelligencePackage = local;
// @ts-expect-error Local correction capability is not canonical issuer authority.
const notARequest: ResearchCorrectionRequest = command;
// @ts-expect-error Local invalidation records omit canonical delivery/reference metadata.
const notAnInvalidation: ResearchInvalidation = invalidation;
void [parsed, validated, registered, notAPackage, notARequest, notAnInvalidation];

declare const prepared: ReturnType<typeof prepareIdentityQuestionFromComposition>;
declare const decisionContext: DecisionContext;
declare const wireRequest: DecisionPortRequest;
const actualPlan: QuestionPlan = prepared.plan;
const requestCheck = checkDecisionRequest(actualPlan, decisionContext);
if (requestCheck.ok) {
  const version: '1.0.0' = requestCheck.value.schema_version;
  const request: DecisionPortRequest = requestCheck.value;
  void [version, request];
} else {
  const code: OperationCode = requestCheck.errors[0].code;
  const path: string = requestCheck.errors[0].path;
  void [code, path];
}
// Compile-only public result signature coverage. No actual EI result is invented
// or consumed by the runtime diagnostic, whose unsupported operation is explicit.
const resultCheck: OperationResult<DecisionPortResult> = checkDecisionResult(wireRequest, prepared, decisionContext);
if (resultCheck.ok) {
  const result: DecisionPortResult = resultCheck.value;
  void result;
} else {
  const errors: readonly { readonly code: OperationCode; readonly path: string }[] = resultCheck.errors;
  void errors;
}
const port: DecisionPort = bindDecisionPort(() => { throw new Error('compile-only sentinel'); });
const returned: Promise<OperationResult<DecisionPortResult>> = port.decide(wireRequest, decisionContext);
// @ts-expect-error An internal question plan lacks the canonical envelope, authority and reference fields.
const notADecisionRequest: DecisionPortRequest = actualPlan;
// @ts-expect-error A preparation result is not a canonical DecisionPort request either.
const notAPreparationRequest: DecisionPortRequest = prepared;
// @ts-expect-error Runtime refusal probes do not make real local plans assignable to the typed port.
port.decide(actualPlan, decisionContext);
void [returned, notADecisionRequest, notAPreparationRequest];
