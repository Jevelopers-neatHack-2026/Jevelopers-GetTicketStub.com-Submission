import {
  QUESTION_REGISTRY,
  prepareDependentQuestions,
  prepareIndependentQuestions,
  type QuestionObservation,
  type QuestionPlan
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

const independent: QuestionPlan = prepareIndependentQuestions([observation]);
const dependent = prepareDependentQuestions([observation], independent);
const readonlyQuestionId: string = QUESTION_REGISTRY[0].questionId;
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
void notExecutable;
void malformed;
