import {
  prepareIdentityQuestionFromComposition,
  type SourceIdentityQuestionPreparationOptions,
  type SourceIdentityQuestionPreparationResult
} from '../../../src/decisions/questions/index.mjs';
import type { SourceIdentityCompositionResult } from '../../../src/discovery/identity/from-extraction.mjs';

declare const composition: SourceIdentityCompositionResult;
const options: SourceIdentityQuestionPreparationOptions = {
  candidateIds: ['event-selected-left', 'event-selected-right'],
  languageByEvidenceId: { '00000000-0000-4000-8000-000000000001': 'en' }
};
const prepared: SourceIdentityQuestionPreparationResult = prepareIdentityQuestionFromComposition(composition, options);

const readiness: 'blocked' = prepared.plan.readinessStatus;
const execution: 'not_dispatched' = prepared.plan.executionStatus;
const promotion: 'unpromoted' = prepared.plan.promotionStatus;
const candidateOnly: true = prepared.plan.candidateOnly;
const decisionPort: 'unavailable' = prepared.plan.decisionPortContractStatus;
const questionId: 'Q-EI-IDENTITY:v1' = prepared.sourceIdentityBinding.questionId;
const localReviewOnly: true = prepared.sourceIdentityBinding.localReviewOnly;
const digest: string = prepared.sourceIdentityBinding.digest;
const observationGroupClaim: string | undefined = prepared.sourceIdentityBinding.observationGroups[0]?.claims[0]?.value;
const observationTextLimit: 4_096 = prepared.sourceIdentityBinding.limits.maxTextBytesPerField;
const hashes: string[] = [
  prepared.plan.sourceEvidenceHash,
  prepared.plan.planHash,
  prepared.sourceIdentityBinding.bindingHashes.targetBindingHash ?? '',
  prepared.sourceIdentityBinding.bindingHashes.targetStateHash ?? '',
  prepared.sourceIdentityBinding.bindingHashes.questionInstanceHash
];

void [readiness, execution, promotion, candidateOnly, decisionPort, questionId, localReviewOnly, digest, observationGroupClaim, observationTextLimit, hashes];
