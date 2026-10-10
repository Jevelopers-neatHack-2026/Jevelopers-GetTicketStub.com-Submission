import { validateContract, checkTrustedContext, checkDecisionRequest, bindDecisionPort, ContractError } from '../generated/index.js';
import type { TrustedContext, UsageEvent, DecisionContext, DecisionPort, DecisionPortRequest, DecisionPortResult, OperationResult, ScoreQuestion, VersionedReference, BudgetReservation } from '../generated/index.js';

function unreachable(value: never): never { throw new ContractError('INVALID_PAYLOAD'); }

export function scopedUsage(input: unknown, authenticatedScope: TrustedContext): UsageEvent | undefined {
  const parsed = validateContract('UsageEvent', input);
  if (!parsed.ok) return undefined;
  const checked = checkTrustedContext(parsed.value, authenticatedScope);
  return checked.ok ? checked.value : undefined;
}

export function questionInstructions(request: DecisionPortRequest, id: string): unknown {
  return request.questions[id]?.instructions;
}

export function choiceFromResult(result: DecisionPortResult, id: string): string | undefined {
  const entry = result.answers[id];
  if (!entry) return undefined;
  switch (entry.status) {
    case 'answered': case 'review':
      switch (entry.answer.type) {
        case 'choice': return entry.answer.choice;
        case 'score': case 'noul': return undefined;
        default: return unreachable(entry.answer);
      }
    case 'unknown': case 'abstain': case 'unavailable': case 'timeout': case 'cancelled': case 'malformed': return undefined;
    default: return unreachable(entry);
  }
}

export function scoreLevels(question: ScoreQuestion): readonly unknown[] {
  switch (question.profile) {
    case 'structured-index-v1': return question.criteria;
    case 'ei-string-v1': return question.index_labels;
    default: return unreachable(question);
  }
}

export function referenceVersion(reference: VersionedReference): '1.0.0' { return reference.schema_version; }

export function budgetReferenceIdentity(request: DecisionPortRequest, budget: BudgetReservation): boolean {
  return request.budget_ref.id === budget.reservation_id;
}

export function injectedPort(handler: (request: DecisionPortRequest, context: DecisionContext) => Promise<unknown>): DecisionPort {
  return bindDecisionPort(handler);
}

export function requestBoundary(input: unknown, serverContext: DecisionContext): OperationResult<DecisionPortRequest> {
  return checkDecisionRequest(input, serverContext);
}
