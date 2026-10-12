import { financeV2Examples, exposure } from './finance-v2-cases.mjs';
import { fixtureReferences, requestReference } from './finance-fixture-seeds.mjs';
import { hashManifest } from '../tooling/runtime.mjs';

const clone = structuredClone;
function bind(example, route) {
  example.value.request_ref = requestReference(example.context.request);
  example.context.references = fixtureReferences(example.value);
  example.context.request_references = fixtureReferences(example.context.request);
  if (route !== 'ordinary') {
    if (route === 'advanced') {
      if (example.context.prior) example.context.command_prior = clone(example.context.prior);
      example.context.prior = clone(example.value.reservation);
      example.context.prior.revision += 4;
      example.context.prior.event_id = '123e4567-e89b-42d3-a456-000000000999';
    }
    example.context.previous_command = clone(example.context.request);
    example.context.previous_result = clone(example.value);
    example.value.disposition = 'duplicate';
  }
  return example;
}
function terminalPrior(example, lifecycle, finalSnapshot) {
  const old = example.context.prior;
  old.lifecycle = lifecycle;
  old.execution_state = 'finished'; old.usage_completeness = 'complete';
  old.settlement_intent = lifecycle === 'consumed' ? 'final' : 'none';
  old.settlement_ref = lifecycle === 'consumed' ? clone(finalSnapshot.settlement_ref) : null;
  old.consumption_evidence_ref = lifecycle === 'consumed' ? clone(finalSnapshot.consumption_evidence_ref) : null;
  if (old.consumption_evidence_ref) old.consumption_evidence_ref.content_hash = 'sha256:' + '8'.repeat(64);
  old.dispatch_cap.amount = '0.000000'; exposure(old);
  if (lifecycle === 'expired') example.context.now = '2026-10-11T14:00:00Z';
}
export async function financeOriginCases() {
  const { seeds, scenarios } = await financeV2Examples();
  const cases = [];
  const families = { SettleResult: seeds.SettleResult, ReleaseResult: seeds.ReleaseResult,
    partial: scenarios.partial, overrun: scenarios.overrun, finalRemainder: scenarios.finalRemainder,
    late: scenarios.late, correction: scenarios.correction };
  const add = (id, example, route, expected) => cases.push({ id, example: bind(example, route), expected });
  for (const [family, seed] of Object.entries(families)) for (const route of ['ordinary', 'fallback', 'advanced']) {
    add(family + '/' + route + '/authentic', clone(seed), route, { ok: true });
    for (const mutation of ['self-prior', 'equal-revision', 'skipped-successor', 'reused-event', 'expected-postrevision']) {
      const example = clone(seed);
      switch (mutation) {
        case 'self-prior':
          example.context.prior = clone(example.value.reservation);
          example.context.request.expected_revision = example.context.prior.revision;
          break;
        case 'equal-revision': example.value.reservation.revision = example.context.prior.revision; break;
        case 'skipped-successor': example.value.reservation.revision += 1; break;
        case 'reused-event': example.value.reservation.event_id = example.context.prior.event_id; break;
        case 'expected-postrevision': example.context.request.expected_revision = example.value.reservation.revision; break;
        default: throw new Error('Unknown origin mutation');
      }
      const stateFailure = mutation === 'self-prior' && ['SettleResult', 'overrun', 'finalRemainder', 'ReleaseResult'].includes(family);
      const code = stateFailure ? 'INVALID_TRANSITION' : mutation === 'expected-postrevision' ? 'INVALID_TRUST_CONTEXT' :
        mutation === 'skipped-successor' ? 'STALE_REVISION' : mutation === 'reused-event' ? 'IDENTITY_COLLISION' : 'REVISION_CONFLICT';
      const path = stateFailure ? family === 'ReleaseResult' ? '/reason' : '/consumption_kind' :
        mutation === 'expected-postrevision' ? '/request' : mutation === 'reused-event' ? '/event_id' : '/revision';
      add(family + '/' + route + '/' + mutation, example, route, { ok: false, code, path });
    }
    if (route !== 'ordinary') {
      const historical = clone(seed);
      historical.context.now = '2026-10-11T14:00:00Z'; historical.context.dispatch_state = 'blocked';
      add(family + '/' + route + '/historical-expired-lease', historical, route, { ok: true });
    }
    for (const revision of [2, 7, 65535]) {
      const example = clone(seed);
      example.context.prior.revision = revision;
      example.context.request.expected_revision = revision;
      example.value.reservation.revision = revision + 1;
      if (example.context.correction_authority) {
        const authority = example.context.correction_authority;
        authority.expected_revision = authority.prior_reservation_ref.revision = revision;
        authority.prior_reservation_ref.content_hash = hashManifest(example.context.prior);
      }
      add(family + '/' + route + '/successor-invariant-' + revision, example, route, { ok: true });
    }
  }
  for (const family of ['SettleResult', 'partial', 'overrun', 'finalRemainder', 'ReleaseResult']) {
    for (const lifecycle of ['consumed', 'released', 'expired']) for (const route of ['ordinary', 'fallback', 'advanced']) {
      const example = clone(families[family]);
      terminalPrior(example, lifecycle, seeds.SettleResult.value.reservation);
      // Revision/event still advance correctly: this challenges state legality independently.
      add(family + '/' + route + '/closed-origin-' + lifecycle, example, route,
        { ok: false, code: 'INVALID_TRANSITION', path: family === 'ReleaseResult' ? '/reason' : '/consumption_kind' });
    }
  }
  for (const mutation of ['revision', 'hash', 'from', 'revoked', 'missing']) for (const route of ['ordinary', 'fallback', 'advanced']) {
    const example = clone(scenarios.correction), authority = example.context.correction_authority;
    switch (mutation) {
      case 'revision': authority.expected_revision += 1; authority.prior_reservation_ref.revision += 1; break;
      case 'hash': authority.prior_reservation_ref.content_hash = 'sha256:' + '8'.repeat(64); break;
      case 'from': authority.from.amount = '0.61'; break;
      case 'revoked': authority.status = 'revoked'; break;
      case 'missing': delete example.context.correction_authority; break;
      default: throw new Error('Unknown authority mutation');
    }
    add('correction/' + route + '/wrong-authority-' + mutation, example, route,
      { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/request' });
  }
  for (const family of ['ReserveResult', 'QueryResult']) for (const route of ['ordinary', 'fallback', 'advanced']) {
    add(family + '/' + route + '/authentic-family', clone(seeds[family]), route, { ok: true });
  }
  for (const [family, seed] of Object.entries(families)) {
    const example = bind(clone(seed), 'fallback');
    example.context.command_prior = clone(seed.context.prior);
    example.context.prior = clone(seed.value.reservation);
    cases.push({ id: family + '/live-equals-cached-with-original-prior', example, expected: { ok: true } });
  }
  for (const route of ['ordinary', 'fallback', 'advanced']) {
    const example = clone(seeds.ReleaseResult);
    example.context.prior.consumed.amount = '0.000001';
    example.context.prior.settlement_intent = 'partial';
    example.context.prior.consumption_evidence_ref = clone(seeds.SettleResult.context.request.usage_ref);
    exposure(example.context.prior);
    add('ReleaseResult/' + route + '/nonzero-origin', example, route, { ok: false, code: 'INVALID_TRANSITION', path: '/reason' });
  }
  for (const family of ['SettleResult', 'ReleaseResult']) for (const route of ['ordinary', 'fallback', 'advanced']) {
    const example = clone(seeds[family]);
    example.context.grant_decision = 'denied';
    for (const snapshot of [example.context.prior, example.value.reservation]) {
      snapshot.decision = 'denied'; snapshot.lifecycle = 'held'; snapshot.settlement_intent = 'none';
      for (const field of ['held', 'consumed', 'overrun', 'dispatch_cap', 'retained_exposure', 'released_capacity',
        'dispatch_acknowledgement_ref', 'consumption_evidence_ref', 'correction_ref', 'settlement_ref']) snapshot[field] = null;
      snapshot.exception_refs = []; snapshot.unreported_exposure = 'none';
    }
    add(family + '/' + route + '/ungranted-origin', example, route, { ok: false, code: 'INVALID_TRANSITION', path: '/reservation_id' });
  }
  return cases;
}
