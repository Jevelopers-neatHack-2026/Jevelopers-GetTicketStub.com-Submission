import { compareEntityIdentity } from '../../../src/discovery/entities/identity.mjs';
import type { EntityIdentityDecision, EntityObservation } from '../../../src/discovery/entities/identity.mjs';
import { compareOccurrenceIdentity, createOccurrenceTransition } from '../../../src/discovery/occurrences/identity.mjs';
import type { OccurrenceIdentityDecision, OccurrenceObservation, OccurrencePrecision, OccurrenceTransitionInput } from '../../../src/discovery/occurrences/identity.mjs';

declare const organizationA: EntityObservation;
declare const organizationB: EntityObservation;
declare const eventA: OccurrenceObservation;
declare const eventB: OccurrenceObservation;
declare const reschedule: OccurrenceTransitionInput;

const entityDecision: EntityIdentityDecision = compareEntityIdentity(organizationA, organizationB);
const occurrenceDecision: OccurrenceIdentityDecision = compareOccurrenceIdentity(eventA, eventB);
const linkedDecision = compareOccurrenceIdentity(eventA, eventB, { transitions: [createOccurrenceTransition(reschedule)] });

if (entityDecision.relation === 'same_entity_candidate') {
  const authorityRemainsUnassessed: 'not_evaluated' = entityDecision.sourceAuthority;
  void authorityRemainsUnassessed;
}

if (occurrenceDecision.relation === 'same_occurrence_candidate') {
  const sourceBoundReason: string = occurrenceDecision.reasonCodes[0];
  void sourceBoundReason;
}

// @ts-expect-error this private comparison output does not decide source authority
const officialSource: boolean = linkedDecision.sourceAuthority;

// @ts-expect-error date precision is explicit and bounded
const inventedPrecision: OccurrencePrecision = 'zoned_local_datetime';

void officialSource;
void inventedPrecision;
