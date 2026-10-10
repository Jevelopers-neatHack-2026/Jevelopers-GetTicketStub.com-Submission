import {
  QUESTION_REGISTRY,
  deriveQuestionTargetRef,
  prepareDependentQuestions,
  prepareIndependentQuestions,
  type QuestionObservation,
  type QuestionPlan,
  type QuestionTargetBindingInput
} from '../../../src/decisions/questions/index.mjs';

const observation: QuestionObservation = {
  observationRef: 'obs-1',
  kind: 'claim_evidence_text',
  sourceRef: 'source-1',
  fieldRef: 'event.date',
  claimText: '2026-11-12',
  language: 'en',
  text: 'The event takes place on November 12.'
};

const factTargetRef = deriveQuestionTargetRef('Q-EI-FACT-SUPPORT:v1', ['obs-1'], {
  fieldRef: 'event.date',
  candidateRefs: ['candidate-1']
});
const targetBinding: QuestionTargetBindingInput = {
  questionId: 'Q-EI-FACT-SUPPORT:v1',
  targetRef: factTargetRef,
  observationRefs: ['obs-1'],
  fieldRef: 'event.date',
  candidateRefs: ['candidate-1']
};
const independent: QuestionPlan = prepareIndependentQuestions([observation], []);
const dependent = prepareDependentQuestions([observation], independent, [targetBinding]);
const readonlyQuestionId: string = QUESTION_REGISTRY[0].questionId;
const readonlyPolicyDocumentHash: string = QUESTION_REGISTRY[0].policyDocumentHash;
const notExecutable: 'not_dispatched' = dependent.executionStatus;

// @ts-expect-error claim evidence requires a field reference and claim text
const malformed: QuestionObservation = {
  observationRef: 'obs-2',
  kind: 'claim_evidence_text',
  sourceRef: 'source-1',
  language: 'en',
  text: 'Text without a field claim.'
};

void readonlyQuestionId;
void readonlyPolicyDocumentHash;
void notExecutable;
void malformed;
