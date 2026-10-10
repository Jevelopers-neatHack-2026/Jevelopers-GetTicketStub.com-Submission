import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareOccurrenceIdentity,
  createOccurrenceTransition,
  OccurrenceIdentityError,
} from '../../../src/discovery/occurrences/identity.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function reference(field, value, options = {}) {
  return {
    evidenceId: options.evidenceId ?? 'schedule-a',
    contentHash: options.contentHash ?? HASH_A,
    locator: options.locator ?? { kind: 'json-pointer', pointer: `/event/${field}` },
    field,
    value,
  };
}

function claim(field, value, options = {}) {
  return {
    value,
    origin: options.origin ?? 'sourced',
    supports: [reference(options.sourceField ?? field, value, options)],
  };
}

function temporal(field, value, precision = 'date', options = {}) {
  return {
    value,
    precision,
    origin: options.origin ?? 'sourced',
    supports: [reference(options.sourceField ?? field, value, options)],
  };
}

function occurrence(candidateId, facts = {}) {
  return { schema: 'ei-occurrence-observation-internal/v1', candidateId, facts };
}

function sharedOccurrenceFacts() {
  const shared = { evidenceId: 'event-page', contentHash: HASH_A };
  return {
    title: [claim('title', 'Moonlight Tour', { ...shared, sourceField: 'event_name' })],
    start: [temporal('start', '2027-06-15', 'date', { ...shared, sourceField: 'event_date' })],
    city: [claim('city', 'Chicago', { ...shared, sourceField: 'city' })],
    venue: [claim('venue', 'Harbor Hall', { ...shared, sourceField: 'venue' })],
  };
}

test('the same tour in separate cities remains separate occurrences', () => {
  const chicago = occurrence('tour-chicago', {
    ...sharedOccurrenceFacts(),
    city: [claim('city', 'Chicago', { evidenceId: 'chicago-listing' })],
  });
  const boston = occurrence('tour-boston', {
    ...sharedOccurrenceFacts(),
    city: [claim('city', 'Boston', { evidenceId: 'boston-listing', contentHash: HASH_B })],
  });

  const result = compareOccurrenceIdentity(chicago, boston);
  assert.equal(result.relation, 'different_occurrence_candidate');
  assert.deepEqual(result.reasonCodes, ['city_mismatch']);
  assert.deepEqual(result.conflictFields, ['city']);
  assert.equal(result.candidates.length, 2);
});
test('annual editions with the same title stay distinct', () => {
  const edition2026 = occurrence('festival-2026', {
    title: [claim('title', 'Harbor Lights Festival')],
    edition: [claim('edition', '2026', { sourceField: 'edition_year' })],
    city: [claim('city', 'Portland')],
    start: [temporal('start', '2026-08-01')],
  });
  const edition2027 = occurrence('festival-2027', {
    title: [claim('title', 'Harbor Lights Festival', { evidenceId: 'festival-page-2027', contentHash: HASH_B })],
    edition: [claim('edition', '2027', { evidenceId: 'festival-page-2027', contentHash: HASH_B, sourceField: 'edition_year' })],
    city: [claim('city', 'Portland', { evidenceId: 'festival-page-2027', contentHash: HASH_B })],
    start: [temporal('start', '2027-08-01', 'date', { evidenceId: 'festival-page-2027', contentHash: HASH_B })],
  });

  const result = compareOccurrenceIdentity(edition2026, edition2027);
  assert.equal(result.relation, 'different_occurrence_candidate');
  assert.deepEqual(result.reasonCodes, ['date_day_mismatch', 'edition_mismatch']);
});

test('only a shared source-bound title and occurrence date produce a same-occurrence candidate', () => {
  const result = compareOccurrenceIdentity(
    occurrence('event-copy-b', sharedOccurrenceFacts()),
    occurrence('event-copy-a', sharedOccurrenceFacts()),
  );

  assert.equal(result.relation, 'same_occurrence_candidate');
  assert.deepEqual(result.reasonCodes, ['shared_source_bound_occurrence_facts']);
  assert.deepEqual(result.candidateIds, ['event-copy-a', 'event-copy-b']);
  assert.equal(result.sourceAuthority, 'not_evaluated');
  assert.equal(result.provenanceReferences.some((ref) => ref.field === 'event_date' && ref.value === '2027-06-15'), true);
  assert.equal(Object.hasOwn(result, 'independentSupportCount'), false);
});

test('compatible facts from different pages remain review candidates; duplicate bytes are not independent support', () => {
  const first = occurrence('listing-a', {
    title: [claim('title', 'Moonlight Tour', { evidenceId: 'listing-a', contentHash: HASH_A })],
    start: [temporal('start', '2027-06-15', 'date', { evidenceId: 'listing-a', contentHash: HASH_A })],
  });
  const syndicated = occurrence('listing-b', {
    title: [claim('title', 'Moonlight Tour', { evidenceId: 'listing-b', contentHash: HASH_A })],
    start: [temporal('start', '2027-06-15', 'date', { evidenceId: 'listing-b', contentHash: HASH_A })],
  });

  const result = compareOccurrenceIdentity(first, syndicated);
  assert.equal(result.relation, 'review');
  assert.deepEqual(result.reasonCodes, ['duplicate_content_is_not_independent_support']);
  assert.deepEqual(result.duplicateContentHashes, [HASH_A]);
  assert.equal(result.provenanceReferences.length, 4);
});

test('changed venue or event status remains a visible conflict', () => {
  const before = occurrence('show-before', {
    ...sharedOccurrenceFacts(),
    venue: [claim('venue', 'Harbor Hall', { evidenceId: 'listing-before' })],
    status: [claim('status', 'scheduled', { evidenceId: 'listing-before' })],
  });
  const updated = occurrence('show-updated', {
    ...sharedOccurrenceFacts(),
    venue: [claim('venue', 'Civic Theater', { evidenceId: 'listing-updated', contentHash: HASH_B })],
    status: [claim('status', 'canceled', { evidenceId: 'listing-updated', contentHash: HASH_B })],
  });

  const result = compareOccurrenceIdentity(before, updated);
  assert.equal(result.relation, 'review');
  assert.deepEqual(result.reasonCodes, ['status_conflict', 'venue_conflict']);
  assert.deepEqual(result.conflictFields, ['status', 'venue']);
  assert.equal(result.candidates.flatMap((candidate) => candidate.facts.venue).length, 2);
});

test('conflicting source dates remain visible and different date-only days are never merged', () => {
  const first = occurrence('date-a', {
    title: [claim('title', 'Late Summer Show')],
    start: [temporal('start', '2027-06-15')],
  });
  const second = occurrence('date-b', {
    title: [claim('title', 'Late Summer Show', { evidenceId: 'event-b', contentHash: HASH_B })],
    start: [temporal('start', '2027-06-16', 'date', { evidenceId: 'event-b', contentHash: HASH_B })],
  });

  const result = compareOccurrenceIdentity(first, second);
  assert.equal(result.relation, 'different_occurrence_candidate');
  assert.deepEqual(result.reasonCodes, ['date_day_mismatch']);
  assert.deepEqual(result.conflictFields, ['start']);
  assert.deepEqual(result.candidates.map((candidate) => candidate.facts.start[0].value), ['2027-06-15', '2027-06-16']);
});

test('date-only, timestamp, and unknown time-zone precision never get silently normalized', () => {
  const dateOnly = occurrence('date-only', {
    title: [claim('title', 'Sunset Series')],
    start: [temporal('start', '2027-06-15', 'date')],
  });
  const timestamp = occurrence('timestamp', {
    title: [claim('title', 'Sunset Series', { evidenceId: 'timestamp-page', contentHash: HASH_B })],
    start: [temporal('start', '2027-06-15T20:00:00-04:00', 'instant', { evidenceId: 'timestamp-page', contentHash: HASH_B })],
  });
  const unknownZone = occurrence('unknown-zone', {
    title: [claim('title', 'Sunset Series', { evidenceId: 'unknown-page', contentHash: 'c'.repeat(64) })],
    start: [temporal('start', '2027-06-15T20:00', 'unknown', { evidenceId: 'unknown-page', contentHash: 'c'.repeat(64) })],
  });

  const mismatch = compareOccurrenceIdentity(dateOnly, timestamp);
  assert.equal(mismatch.relation, 'review');
  assert.deepEqual(mismatch.reasonCodes, ['date_precision_mismatch']);
  assert.deepEqual(mismatch.conflictFields, ['start']);
  assert.equal(mismatch.candidates[0].facts.start[0].precision, 'date');
  assert.equal(mismatch.candidates[1].facts.start[0].precision, 'instant');

  const unknown = compareOccurrenceIdentity(timestamp, unknownZone);
  assert.equal(unknown.relation, 'review');
  assert.deepEqual(unknown.reasonCodes, ['date_precision_unknown']);
  assert.equal(unknown.candidates[1].facts.start[0].value, '2027-06-15T20:00');
});

test('conflicting claims within one candidate are retained and require review', () => {
  const conflicted = occurrence('conflicted-date', {
    title: [claim('title', 'Evening Gala')],
    start: [
      temporal('start', '2027-09-03', 'date', { evidenceId: 'source-one' }),
      temporal('start', '2027-09-04', 'date', { evidenceId: 'source-two', contentHash: HASH_B }),
    ],
  });
  const other = occurrence('other-date', {
    title: [claim('title', 'Evening Gala', { evidenceId: 'source-three', contentHash: 'c'.repeat(64) })],
    start: [temporal('start', '2027-09-03', 'date', { evidenceId: 'source-three', contentHash: 'c'.repeat(64) })],
  });

  const result = compareOccurrenceIdentity(conflicted, other);
  assert.equal(result.relation, 'review');
  assert.deepEqual(result.reasonCodes, ['candidate_fact_conflict']);
  assert.deepEqual(result.conflictFields, ['start']);
  assert.equal(result.provenanceReferences.length, 5);
  assert.equal(result.candidates[0].facts.start.length, 2);
});

test('reschedule link is immutable, source-backed, and preserves predecessor identity', () => {
  const oldOccurrence = occurrence('tour-stop-old', {
    title: [claim('title', 'Moonlight Tour')],
    start: [temporal('start', '2027-06-15')],
    status: [claim('status', 'scheduled')],
  });
  const newOccurrence = occurrence('tour-stop-new', {
    title: [claim('title', 'Moonlight Tour', { evidenceId: 'reschedule-notice', contentHash: HASH_B })],
    start: [temporal('start', '2027-06-22', 'date', { evidenceId: 'reschedule-notice', contentHash: HASH_B })],
    status: [claim('status', 'rescheduled', { evidenceId: 'reschedule-notice', contentHash: HASH_B })],
  });
  const transition = createOccurrenceTransition({
    predecessorId: 'tour-stop-old',
    successorId: 'tour-stop-new',
    transition: 'rescheduled',
    supports: [reference('status', 'rescheduled', { evidenceId: 'reschedule-notice', contentHash: HASH_B })],
  });

  const result = compareOccurrenceIdentity(oldOccurrence, newOccurrence, { transitions: [transition] });
  assert.equal(result.relation, 'different_occurrence_candidate');
  assert.deepEqual(result.reasonCodes, ['date_day_mismatch', 'explicit_reschedule_successor_link', 'status_conflict']);
  assert.deepEqual(result.conflictFields, ['start', 'status']);
  assert.equal(result.provenanceReferences.some((ref) => ref.evidenceId === 'reschedule-notice' && ref.value === 'rescheduled'), true);
  assert.equal(result.transitionLinks[0].predecessorId, 'tour-stop-old');
  assert.equal(result.transitionLinks[0].successorId, 'tour-stop-new');
  assert.equal(Object.isFrozen(transition), true);
  assert.throws(() => { transition.successorId = 'rewritten'; }, TypeError);
});

test('cancellation evidence creates an immutable predecessor record without claiming a successor', () => {
  const scheduled = occurrence('old-show', {
    title: [claim('title', 'Garden Stage')],
    start: [temporal('start', '2027-07-10')],
  });
  const canceled = occurrence('canceled-record', {
    title: [claim('title', 'Garden Stage', { evidenceId: 'notice', contentHash: HASH_B })],
    start: [temporal('start', '2027-07-10', 'date', { evidenceId: 'notice', contentHash: HASH_B })],
    status: [claim('status', 'canceled', { evidenceId: 'notice', contentHash: HASH_B })],
  });
  const transition = createOccurrenceTransition({
    predecessorId: 'old-show',
    successorId: null,
    transition: 'canceled',
    supports: [reference('status', 'canceled', { evidenceId: 'notice', contentHash: HASH_B })],
  });

  const result = compareOccurrenceIdentity(scheduled, canceled, { transitions: [transition] });
  assert.equal(result.relation, 'review');
  assert.deepEqual(result.reasonCodes, ['explicit_cancellation_evidence']);
  assert.equal(result.transitionLinks[0].predecessorId, 'old-show');
  assert.equal(result.transitionLinks[0].successorId, null);
});

test('comparison ordering and provenance are stable when candidates are supplied in either order', () => {
  const left = occurrence('z-stop', {
    title: [claim('title', 'Shared Series', { evidenceId: 'listing-z' })],
    venue: [claim('venue', 'Old Hall', { evidenceId: 'listing-z' })],
    start: [temporal('start', '2027-05-01')],
  });
  const right = occurrence('a-stop', {
    title: [claim('title', 'Shared Series', { evidenceId: 'listing-a', contentHash: HASH_B })],
    venue: [claim('venue', 'New Hall', { evidenceId: 'listing-a', contentHash: HASH_B })],
    start: [temporal('start', '2027-05-01', 'date', { evidenceId: 'listing-a', contentHash: HASH_B })],
  });

  const forward = compareOccurrenceIdentity(left, right);
  const reverse = compareOccurrenceIdentity(right, left);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.reasonCodes, ['venue_conflict']);
  assert.deepEqual(forward.candidateIds, ['a-stop', 'z-stop']);
  assert.equal(forward.provenanceReferences[0].evidenceId, 'listing-a');
});

test('malformed, accessor-backed, private, and forged transition inputs fail closed', () => {
  let getterCalled = false;
  const accessorFacts = {};
  Object.defineProperty(accessorFacts, 'title', { enumerable: true, get() { getterCalled = true; return []; } });
  const accessor = { schema: 'ei-occurrence-observation-internal/v1', candidateId: 'bad', facts: accessorFacts };
  const valid = occurrence('valid');

  assert.throws(() => compareOccurrenceIdentity(accessor, valid), OccurrenceIdentityError);
  assert.equal(getterCalled, false);
  assert.throws(() => compareOccurrenceIdentity(Object.create({ candidateId: 'inherited' }), valid), OccurrenceIdentityError);
  assert.throws(() => compareOccurrenceIdentity({ ...valid, official: true }, valid), OccurrenceIdentityError);
  assert.throws(() => compareOccurrenceIdentity(occurrence('null-fact', { title: null }), valid), OccurrenceIdentityError);
  assert.throws(() => compareOccurrenceIdentity(valid, occurrence('null-options'), { transitions: null }), OccurrenceIdentityError);
  assert.throws(() => compareOccurrenceIdentity(occurrence('bad-date', { start: [temporal('start', '2027-02-29')] }), valid), OccurrenceIdentityError);
  assert.throws(() => createOccurrenceTransition({
    predecessorId: 'old', successorId: 'new', transition: 'rescheduled',
    supports: [reference('status', 'scheduled')],
  }), OccurrenceIdentityError);

  const link = createOccurrenceTransition({
    predecessorId: 'old', successorId: 'new', transition: 'rescheduled',
    supports: [reference('status', 'rescheduled')],
  });
  assert.throws(() => compareOccurrenceIdentity(valid, occurrence('other'), { transitions: [{ ...link, successorId: 'forged' }] }), OccurrenceIdentityError);
});

test('conflicting cancellation and reschedule links stay visible and deterministic', () => {
  const oldOccurrence = occurrence('old-conflict', {
    title: [claim('title', 'Moonlight Tour')],
    start: [temporal('start', '2027-06-15')],
    status: [
      claim('status', 'scheduled'),
      claim('status', 'canceled', { evidenceId: 'cancel-notice', contentHash: HASH_B }),
    ],
  });
  const newOccurrence = occurrence('new-conflict', {
    title: [claim('title', 'Moonlight Tour', { evidenceId: 'reschedule-notice', contentHash: 'c'.repeat(64) })],
    start: [temporal('start', '2027-06-22', 'date', { evidenceId: 'reschedule-notice', contentHash: 'c'.repeat(64) })],
    status: [claim('status', 'rescheduled', { evidenceId: 'reschedule-notice', contentHash: 'c'.repeat(64) })],
  });
  const cancellation = createOccurrenceTransition({
    predecessorId: 'old-conflict', successorId: null, transition: 'canceled',
    supports: [reference('status', 'canceled', { evidenceId: 'cancel-notice', contentHash: HASH_B })],
  });
  const reschedule = createOccurrenceTransition({
    predecessorId: 'old-conflict', successorId: 'new-conflict', transition: 'rescheduled',
    supports: [reference('status', 'rescheduled', { evidenceId: 'reschedule-notice', contentHash: 'c'.repeat(64) })],
  });

  const forward = compareOccurrenceIdentity(oldOccurrence, newOccurrence, { transitions: [cancellation, reschedule] });
  const reverse = compareOccurrenceIdentity(newOccurrence, oldOccurrence, { transitions: [reschedule, cancellation] });
  assert.deepEqual(forward, reverse);
  assert.equal(forward.relation, 'review');
  assert.equal(forward.transitionLinks.length, 2);
  assert.equal(forward.provenanceReferences.some((ref) => ref.evidenceId === 'cancel-notice'), true);
  assert.equal(forward.provenanceReferences.some((ref) => ref.evidenceId === 'reschedule-notice'), true);
  assert.deepEqual(forward.reasonCodes, [
    'candidate_fact_conflict',
    'conflicting_transition_links',
    'explicit_cancellation_evidence',
    'explicit_reschedule_successor_link',
  ]);
});
