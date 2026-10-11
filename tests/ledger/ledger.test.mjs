import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import {
  appendLedgerEvent,
  rebuildLedgerProjection,
  validateLedgerAppendRequestBoundary,
  validateLedgerProjectionRequestBoundary,
} from '../../dist/index.js';
import { assertDisposableMarker, databaseConfigFromEnvironment, DISPOSABLE_MARKER } from '../../scripts/test-db-lifecycle.mjs';

const { Pool } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = join(root, 'fixtures/ledger/ci02-synthetic-acceptance.json');
const fixedTime = '2026-10-11T03:00:00.000Z';
const producerRevision = 'a'.repeat(40);

function randomId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function contentHash(label) {
  return `sha256:${createHash('sha256').update(`ci02-synthetic:${label}`).digest('hex')}`;
}

function evidenceRef(label) {
  return {
    contract: 'ci02.synthetic.fixture',
    schema_version: '1.0.0',
    id: label,
    revision: 1,
    content_hash: contentHash(`evidence:${label}`),
  };
}

function makeScope(label) {
  const suffix = randomUUID();
  return {
    tenantId: `ci02-tenant-${suffix}`,
    projectId: `ci02-project-${suffix}`,
    environment: 'test',
    billingMode: 'simulated',
    actorId: `ci02-actor-${label}`,
  };
}

function makeRequest(scope, options = {}) {
  const eventId = options.eventId ?? randomId('event');
  const amount = Object.hasOwn(options, 'amount') ? options.amount : '0.01';
  const valuation = options.valuation ?? 'provider_confirmed';
  const revisionSequence = options.revisionSequence ?? 0;
  const sourceEventId = options.sourceEventId ?? `source-${eventId}`;
  const sourceObjectId = options.sourceObjectId ?? `source-object-${eventId}`;
  const revisionSubjectId = options.revisionSubjectId ?? `line-${eventId}`;
  const identities = options.identities ?? {};
  const logicalOperationId = identities.logicalOperationId ?? options.logicalOperationId ?? randomId('operation');
  const postingMapping = options.postingMapping ?? {
    schemaVersion: '1.0.0',
    sourceLineId: revisionSubjectId,
    transportAttemptId: { status: 'known', id: options.transportAttemptId ?? `transport-${logicalOperationId}-${revisionSubjectId}` },
    providerAttemptId: { status: 'known', id: options.providerAttemptId ?? `provider-${logicalOperationId}-${revisionSubjectId}` },
    providerRequestId: { status: 'not_applicable' },
    billableAttemptId: { status: 'known', id: options.billableAttemptId ?? `billable-${logicalOperationId}-${revisionSubjectId}` },
  };
  const pricing = options.pricing ?? (valuation === 'estimated' ? {
    policyVersion: 'synthetic-policy-1',
    ruleVersion: 'synthetic-rule-1',
    rateCardRef: null,
  } : null);
  const usage = options.usage ?? {
    completeness: 'complete',
    missingFields: [],
    units: [{ name: 'tokens', quantity: '1', scale: 0, relation: 'standalone' }],
  };
  return {
    schemaVersion: '1.0.0',
    requestId: options.requestId ?? `request-${eventId}`,
    idempotencyKey: options.idempotencyKey ?? `idempotency-${eventId}`,
    scope,
    eventId,
    correlationId: options.correlationId ?? `correlation-${eventId}`,
    producer: { module: 'ci02.synthetic.test', sourceRevision: producerRevision, buildRevision: 'fixture-build-1' },
    occurredAt: options.occurredAt ?? '2026-10-10T22:00:00.000Z',
    observedAt: options.observedAt ?? '2026-10-10T22:00:01.000Z',
    evidenceMode: options.evidenceMode ?? 'mocked',
    verificationStatus: options.verificationStatus ?? 'verified',
    eventType: options.eventType ?? 'expense',
    classification: options.classification ?? 'direct_cost',
    valuation,
    settlementStatus: options.settlementStatus ?? 'unpaid',
    reconciliationStatus: options.reconciliationStatus ?? 'unmatched',
    reservationLifecycle: Object.hasOwn(options, 'reservationLifecycle') ? options.reservationLifecycle : null,
    identities: {
      logicalOperationId,
      sourceObservationId: identities.sourceObservationId ?? randomId('observation'),
      reservationId: Object.hasOwn(identities, 'reservationId') ? identities.reservationId : null,
    },
    postingMapping,
    sourceIdentity: {
      source: 'ci02-synthetic',
      sourceEventId,
      sourceObjectId,
      revisionSubjectId,
      sourceRevision: `fixture-revision-${revisionSequence}`,
      revisionSequence,
      contentHash: options.sourceContentHash ?? contentHash(`source:${sourceEventId}`),
    },
    usage,
    money: {
      amount,
      currency: options.currency ?? 'USD',
      scale: options.scale ?? (typeof amount === 'string' ? amount.split('.')[1]?.length ?? 0 : 0),
    },
    sourceRefs: options.sourceRefs ?? [],
    dimensions: options.dimensions ?? {},
    pricing,
    fxEvidence: options.fxEvidence ?? null,
    financialEffect: Object.hasOwn(options, 'financialEffect') ? options.financialEffect : true,
    reservationAuthorizationEventId: Object.hasOwn(options, 'reservationAuthorizationEventId')
      ? options.reservationAuthorizationEventId : null,
    supersedesEventId: options.supersedesEventId ?? null,
    reversesEventId: options.reversesEventId ?? null,
  };
}

function makePorts(pool, scope, clock) {
  return {
    database: { connect: () => pool.connect() },
    trustedContext: { resolve: async () => ({ ...scope }) },
    clock: { now: () => new Date(clock.value) },
  };
}

async function append(request, ports, expectedStatus = 'accepted') {
  const result = await appendLedgerEvent(request, ports);
  assert.equal(result.ok, true, result.ok ? '' : `${result.error.code}: ${result.error.safe_message}`);
  assert.equal(result.value.status, expectedStatus,
    `Ledger append returned ${result.value.status}; expected ${expectedStatus}.`);
  return result.value;
}

async function project(scope, ports, asOf) {
  const result = await rebuildLedgerProjection({
    schemaVersion: '1.0.0', requestId: randomId('projection'), scope, asOf,
  }, ports);
  assert.equal(result.ok, true, result.ok ? '' : `${result.error.code}: ${result.error.safe_message}`);
  return result.value;
}

function amountRow(projection, eventType, classification, currency) {
  return projection.amounts.find(row => row.eventType === eventType
    && row.classification === classification && row.currency === currency);
}

function normalizeDecimal(value) {
  if (value === null) return null;
  const [whole, fraction = ''] = String(value).split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
}

test('CI02 ledger persists exact immutable records and rebuilds scoped projections in PostgreSQL 16', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.deepEqual(fixture.provenance, {
    synthetic: true, environment: 'test', billing_mode: 'simulated', evidence_mode: 'mocked', external_calls: 0,
  });
  assert.ok(process.env.CI_TEST_DB_HOST, 'ledger suite requires the disposable PostgreSQL harness');
  const pool = new Pool({ ...databaseConfigFromEnvironment('CI_TEST_DB'), max: 24 });
  const clock = { value: fixedTime };
  const image = JSON.parse(await readFile(join(root, 'postgres-test-image.json'), 'utf8'));
  let postgresVersion = '';
  let completed = false;
  try {
    const marker = await pool.query('SELECT marker FROM ci_test.disposable_database_marker');
    assertDisposableMarker(marker.rows);
    assert.equal(marker.rows[0].marker, DISPOSABLE_MARKER);
    const server = await pool.query('SHOW server_version_num');
    postgresVersion = String(server.rows[0].server_version_num);
    assert.equal(postgresVersion.slice(0, 2), '16', 'ledger acceptance must run on PostgreSQL 16');
    const health = await pool.query('SELECT migrations_ready, required_migrations_present FROM cost_intelligence.foundation_health');
    assert.equal(health.rows[0].migrations_ready, true);
    assert.equal(Number(health.rows[0].required_migrations_present), 3);

    const scope = makeScope('union');
    const eventCases = [
      ['usage_observation', { classification: 'usage_memo', financialEffect: false, usage: { completeness: 'unknown', missingFields: ['tokens'], units: [] } }],
      ['reservation_authorized', { classification: 'reservation_memo', financialEffect: false, reservationLifecycle: 'held', identities: { reservationId: randomId('reservation') } }],
      ['dispatch', { classification: 'reservation_memo', financialEffect: false, reservationLifecycle: 'dispatched', identities: { reservationId: randomId('reservation') }, reservationAuthorizationEventId: randomId('authorization') }],
      ['charge', {}], ['consumption', { reservationLifecycle: 'partially_settled' }], ['reservation_release', { classification: 'reservation_memo', financialEffect: false, reservationLifecycle: 'released', identities: { reservationId: randomId('reservation') }, reservationAuthorizationEventId: randomId('authorization') }],
      ['expense', {}], ['revenue', {}], ['refund', {}], ['credit', {}], ['discount', {}], ['fee', {}], ['tax', {}], ['reimbursement', {}], ['cash_movement', {}],
      ['reversal', { amount: '-0.01', reversesEventId: randomId('original'), sourceRefs: [evidenceRef('union-reversal')] }],
      ['adjustment', { sourceRefs: [evidenceRef('union-adjustment')] }],
      ['correction', { supersedesEventId: randomId('prior'), sourceRefs: [evidenceRef('union-correction')] }],
    ];
    for (const [eventType, options] of eventCases) {
      const request = makeRequest(scope, { ...options, eventType });
      const result = validateLedgerAppendRequestBoundary(request);
      assert.equal(result.ok, true, `${eventType} should be represented by the versioned event union`);
    }
    const impossibleDispatch = makeRequest(scope, {
      eventType: 'dispatch', classification: 'reservation_memo', financialEffect: true,
      reservationLifecycle: 'dispatched', identities: { reservationId: randomId('reservation') },
      reservationAuthorizationEventId: randomId('authorization'),
    });
    assert.equal(validateLedgerAppendRequestBoundary(impossibleDispatch).ok, false, 'dispatch cannot post recognized financial effect');
    const badScale = makeRequest(scope, { amount: '0.0000000000000000001', scale: 19 });
    assert.equal(validateLedgerAppendRequestBoundary(badScale).ok, false, 'unsupported decimal scales reject before persistence');
    const negativeUsage = makeRequest(scope, { usage: {
      completeness: 'complete', missingFields: [], units: [{ name: 'tokens', quantity: '-1', scale: 0, relation: 'standalone' }],
    } });
    assert.equal(validateLedgerAppendRequestBoundary(negativeUsage).ok, false, 'negative usage units reject');
    assert.equal(validateLedgerProjectionRequestBoundary({
      schemaVersion: '1.0.0', requestId: 'invalid-projection', scope, asOf: '2026-10-11T03:00:00-04:00',
    }).ok, false, 'projection times must be UTC Z instants');

    const protectedScope = makeScope('trusted');
    let connects = 0;
    const protectedPorts = {
      ...makePorts(pool, protectedScope, clock),
      database: { connect: async () => { connects++; return pool.connect(); } },
    };
    const forged = makeRequest(protectedScope, { eventId: randomId('forged') });
    forged.scope = { ...protectedScope, billingMode: 'live' };
    const denied = await appendLedgerEvent(forged, protectedPorts);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.code, 'FORBIDDEN_SCOPE');
    assert.equal(connects, 0, 'forged billing mode must be rejected before opening a database transaction');

    const idempotencyScope = makeScope('idempotency-contention');
    const idempotencyPorts = makePorts(pool, idempotencyScope, clock);
    const sameRequest = makeRequest(idempotencyScope, { amount: '0.05' });
    const racing = await Promise.all([
      appendLedgerEvent(sameRequest, idempotencyPorts),
      appendLedgerEvent(sameRequest, idempotencyPorts),
    ]);
    assert.ok(racing.every(result => result.ok), `idempotent race outcomes: ${JSON.stringify(racing)}`);
    const racingStatuses = racing.map(result => result.ok ? result.value.status : 'error').sort();
    assert.deepEqual(racingStatuses, ['accepted', 'duplicate'], 'same idempotency key race must resolve as accepted plus duplicate');
    const duplicate = await append(sameRequest, idempotencyPorts, 'duplicate');
    assert.equal(duplicate.existingEventId, sameRequest.eventId);
    const conflictingReplay = await append({ ...sameRequest, money: { ...sameRequest.money, amount: '0.06' } }, idempotencyPorts, 'conflict');
    assert.equal(conflictingReplay.existingEventId, sameRequest.eventId);

    const observationScope = makeScope('source-binding-contention');
    const observationPorts = makePorts(pool, observationScope, clock);
    const observationId = randomId('observation-shared');
    const observationSourceEventId = randomId('source-event-shared');
    const firstObservation = makeRequest(observationScope, {
      identities: { sourceObservationId: observationId }, sourceEventId: observationSourceEventId,
      sourceObjectId: 'same-source-object', revisionSubjectId: 'same-source-line',
    });
    const secondObservation = {
      ...firstObservation,
      eventId: randomId('event-race'), requestId: randomId('request-race'), idempotencyKey: randomId('idempotency-race'),
      correlationId: randomId('correlation-race'),
      identities: {
        ...firstObservation.identities,
      },
      postingMapping: {
        ...firstObservation.postingMapping,
        transportAttemptId: { status: 'known', id: randomId('transport-race') },
        providerAttemptId: { status: 'known', id: randomId('provider-race') },
      },
    };
    const observationRace = await Promise.all([
      appendLedgerEvent(firstObservation, observationPorts), appendLedgerEvent(secondObservation, observationPorts),
    ]);
    assert.ok(observationRace.every(result => result.ok));
    assert.deepEqual(observationRace.map(result => result.ok ? result.value.status : 'error').sort(), ['accepted', 'conflict']);

    const retryScope = makeScope('billable-attempts');
    const retryPorts = makePorts(pool, retryScope, clock);
    const operationId = randomId('logical-operation');
    const retryObject = randomId('provider-source-object');
    await append(makeRequest(retryScope, {
      eventType: 'charge', amount: '0.02', logicalOperationId: operationId,
      sourceObjectId: retryObject, revisionSubjectId: 'retry-line-1',
    }), retryPorts);
    await append(makeRequest(retryScope, {
      eventType: 'charge', amount: '0.03', logicalOperationId: operationId,
      sourceObjectId: retryObject, revisionSubjectId: 'retry-line-2',
    }), retryPorts);
    const retryProjection = await project(retryScope, retryPorts, '2026-10-11T03:02:00.000Z');
    const retryRow = amountRow(retryProjection, 'charge', 'direct_cost', 'USD');
    assert.equal(retryRow.eventCount, fixture.billable_retries.expected_event_count);
    assert.equal(retryRow.knownSubtotal, '0.05');

    const tinyScope = makeScope('tiny-costs');
    const tinyPorts = makePorts(pool, tinyScope, clock);
    const tinyObjectId = randomId('shared-source-object');
    const batchSize = 25;
    for (let start = 0; start < fixture.exact_money.count; start += batchSize) {
      const requests = Array.from({ length: Math.min(batchSize, fixture.exact_money.count - start) }, (_, offset) => {
        const index = start + offset;
        return makeRequest(tinyScope, {
          amount: fixture.exact_money.unit_amount,
          currency: fixture.exact_money.currency,
          logicalOperationId: `tiny-op-${index}`,
          billableAttemptId: `tiny-billable-${index}`,
          sourceObjectId: tinyObjectId,
          revisionSubjectId: `tiny-line-${index}`,
          scale: 5,
        });
      });
      await Promise.all(requests.map(request => append(request, tinyPorts)));
    }
    const tinyProjection = await project(tinyScope, tinyPorts, '2026-10-11T03:02:00.000Z');
    const tinyRow = amountRow(tinyProjection, 'expense', 'direct_cost', 'USD');
    assert.equal(tinyRow.eventCount, fixture.exact_money.count);
    assert.equal(tinyRow.knownSubtotal, fixture.exact_money.expected_total, '1,000 exact USD 0.00001 amounts must sum to USD 0.01');
    assert.equal(tinyRow.totalAmount, fixture.exact_money.expected_total);

    const unknownScope = makeScope('unknowns');
    const unknownPorts = makePorts(pool, unknownScope, clock);
    await append(makeRequest(unknownScope, {
      amount: null,
      valuation: 'unknown',
      usage: { completeness: 'unknown', missingFields: ['amount', 'tokens'], units: [] },
    }), unknownPorts);
    const unknownProjection = await project(unknownScope, unknownPorts, '2026-10-11T03:02:00.000Z');
    const unknownAmount = amountRow(unknownProjection, 'expense', 'direct_cost', 'USD');
    assert.equal(unknownAmount.knownSubtotal, null);
    assert.equal(unknownAmount.totalAmount, null);
    assert.equal(unknownAmount.unknownAmountCount, 1);
    assert.equal(unknownAmount.completeness, fixture.unknowns.expected_amount_completeness);
    const unknownQuantity = unknownProjection.quantities.find(row => row.eventType === 'expense' && row.classification === 'direct_cost');
    assert.equal(unknownQuantity.unitName, null);
    assert.equal(unknownQuantity.relation, null);
    assert.equal(unknownQuantity.totalQuantity, null);
    assert.equal(unknownQuantity.completeness, fixture.unknowns.expected_quantity_completeness);

    const currencyScope = makeScope('currency-partition');
    const currencyPorts = makePorts(pool, currencyScope, clock);
    await append(makeRequest(currencyScope, { currency: 'USD', amount: '0.10' }), currencyPorts);
    await append(makeRequest(currencyScope, { currency: 'EUR', amount: '0.10' }), currencyPorts);
    const currencyProjection = await project(currencyScope, currencyPorts, '2026-10-11T03:02:00.000Z');
    assert.equal(amountRow(currencyProjection, 'expense', 'direct_cost', 'USD').totalAmount, '0.1');
    assert.equal(amountRow(currencyProjection, 'expense', 'direct_cost', 'EUR').totalAmount, '0.1');

    const fxScope = makeScope('sourced-fx');
    const fxPorts = makePorts(pool, fxScope, clock);
    const fxRequest = makeRequest(fxScope, {
      amount: '0.10', currency: 'USD',
      fxEvidence: {
        sourceRef: evidenceRef('fx-rate-source'), sourceCurrency: 'USD', targetCurrency: 'EUR',
        rate: '0.91', effectiveAt: '2026-10-10T21:59:00.000Z',
      },
    });
    await append(fxRequest, fxPorts);
    const fxRow = await pool.query(
      `SELECT currency, amount::text AS amount, amount_scale, event_payload #>> '{money,amount}' AS amount_lexeme, fx_evidence
       FROM cost_intelligence.financial_ledger_events WHERE event_id = $1`,
      [fxRequest.eventId],
    );
    assert.equal(fxRow.rows[0].currency, 'USD');
    assert.equal(fxRow.rows[0].amount_lexeme, '0.10');
    assert.equal(fxRow.rows[0].amount_scale, 2);
    assert.equal(fxRow.rows[0].fx_evidence.rate, '0.91');
    assert.equal(fxRow.rows[0].fx_evidence.effectiveAt, '2026-10-10T21:59:00.000Z');
    assert.equal(fxRow.rows[0].fx_evidence.sourceRef.content_hash, contentHash('evidence:fx-rate-source'));
    const badFx = makeRequest(fxScope, {
      fxEvidence: { ...fxRequest.fxEvidence, targetCurrency: 'USD' },
    });
    assert.equal(validateLedgerAppendRequestBoundary(badFx).ok, false, 'FX conversion cannot mix or alias source and target currencies');
    const fxProjection = await project(fxScope, fxPorts, '2026-10-11T03:02:00.000Z');
    assert.equal(amountRow(fxProjection, 'expense', 'direct_cost', 'USD').totalAmount, '0.1', 'FX evidence is retained without implicit conversion');

    const correctionScope = makeScope('estimate-correction');
    const correctionPorts = makePorts(pool, correctionScope, clock);
    const estimate = makeRequest(correctionScope, {
      amount: fixture.estimated_correction.estimate, valuation: 'estimated', logicalOperationId: 'estimate-operation',
      billableAttemptId: 'estimate-billable', sourceObjectId: 'estimate-source', revisionSubjectId: 'estimate-line',
      sourceEventId: 'estimate-v0', sourceContentHash: contentHash('estimate-v0'), revisionSequence: 0,
    });
    await append(estimate, correctionPorts);
    clock.value = '2026-10-11T03:01:00.000Z';
    const confirmed = makeRequest(correctionScope, {
      eventType: 'correction', amount: fixture.estimated_correction.confirmed, valuation: 'provider_confirmed',
      logicalOperationId: 'estimate-operation', billableAttemptId: 'estimate-billable',
      sourceObjectId: 'estimate-source', revisionSubjectId: 'estimate-line', sourceEventId: 'estimate-v1',
      sourceContentHash: contentHash('estimate-v1'), revisionSequence: 1, supersedesEventId: estimate.eventId,
      sourceRefs: [evidenceRef('estimate-correction-proof')],
    });
    await append(confirmed, correctionPorts);
    const beforeCorrection = await project(correctionScope, correctionPorts, '2026-10-11T03:00:30.000Z');
    assert.equal(amountRow(beforeCorrection, 'expense', 'direct_cost', 'USD').totalAmount, '1');
    const afterCorrection = await project(correctionScope, correctionPorts, '2026-10-11T03:02:00.000Z');
    assert.equal(amountRow(afterCorrection, 'expense', 'direct_cost', 'USD'), undefined);
    assert.equal(amountRow(afterCorrection, 'correction', 'direct_cost', 'USD').totalAmount, fixture.estimated_correction.effective);
    const rebuiltCorrection = await project(correctionScope, correctionPorts, '2026-10-11T03:02:00.000Z');
    assert.equal(rebuiltCorrection.projectionHash, afterCorrection.projectionHash, 'persisted as-of rebuilds must be deterministic');

    const reservationScope = makeScope('reservation-protocol');
    const reservationPorts = makePorts(pool, reservationScope, clock);
    const reservationId = randomId('reservation');
    const reservationLogical = randomId('reserved-operation');
    const billableAttemptId = randomId('reserved-billable-attempt');
    const reservationSource = randomId('reservation-source');
    const authorization = makeRequest(reservationScope, {
      eventType: 'reservation_authorized', classification: 'reservation_memo', amount: fixture.cumulative_reservation.authorization,
      valuation: 'estimated', financialEffect: false, reservationLifecycle: 'held', logicalOperationId: reservationLogical,
      billableAttemptId, sourceObjectId: reservationSource, revisionSubjectId: 'authorization-line',
      sourceEventId: 'reservation-authorized-source', identities: { reservationId },
    });
    await append(authorization, reservationPorts);
    const secondAuthorization = makeRequest(reservationScope, {
      eventType: 'reservation_authorized', classification: 'reservation_memo', amount: '2.00', valuation: 'estimated',
      financialEffect: false, reservationLifecycle: 'held', logicalOperationId: reservationLogical,
      billableAttemptId, sourceObjectId: reservationSource, revisionSubjectId: 'authorization-line-replay',
      sourceEventId: 'reservation-authorized-source-replay', identities: { reservationId },
    });
    const duplicateGrant = await append(secondAuthorization, reservationPorts, 'conflict');
    assert.equal(duplicateGrant.existingEventId, authorization.eventId, 'one reservation identity cannot create a second grant event');
    const dispatch = makeRequest(reservationScope, {
      eventType: 'dispatch', classification: 'reservation_memo', financialEffect: false, reservationLifecycle: 'dispatched',
      amount: fixture.cumulative_reservation.authorization, valuation: 'estimated', logicalOperationId: reservationLogical,
      billableAttemptId, sourceObjectId: reservationSource, revisionSubjectId: 'dispatch-line', sourceEventId: 'reservation-dispatch-source',
      identities: { reservationId }, reservationAuthorizationEventId: authorization.eventId,
    });
    await append(dispatch, reservationPorts);

    const consumptionOptions = (amount, revisionSequence, eventType = 'consumption', supersedesEventId = null, reservationLifecycle = 'partially_settled') => ({
      eventType, amount, classification: 'direct_cost', valuation: 'provider_confirmed',
      settlementStatus: 'unpaid', reservationLifecycle, logicalOperationId: reservationLogical, billableAttemptId,
      sourceObjectId: reservationSource, revisionSubjectId: 'consumption-line',
      sourceEventId: `consumption-source-v${revisionSequence}`, sourceContentHash: contentHash(`consumption-v${revisionSequence}`),
      revisionSequence, supersedesEventId, identities: { reservationId },
      reservationAuthorizationEventId: authorization.eventId,
    });
    const firstPartial = makeRequest(reservationScope, consumptionOptions(fixture.cumulative_reservation.first_partial, 0));
    await append(firstPartial, reservationPorts);
    const secondPartial = makeRequest(reservationScope, consumptionOptions(
      fixture.cumulative_reservation.second_partial, 1, 'consumption', firstPartial.eventId,
    ));
    await append(secondPartial, reservationPorts);
    const rejectedDecrease = makeRequest(reservationScope, consumptionOptions('0.30', 2, 'consumption', secondPartial.eventId));
    await append(rejectedDecrease, reservationPorts, 'conflict');
    const finalOverrun = makeRequest(reservationScope, consumptionOptions(
      fixture.cumulative_reservation.final_overrun, 2, 'consumption', secondPartial.eventId, 'settled',
    ));
    await append(finalOverrun, reservationPorts);
    const overrunProjection = await project(reservationScope, reservationPorts, '2026-10-11T03:02:00.000Z');
    assert.equal(amountRow(overrunProjection, 'consumption', 'direct_cost', 'USD').totalAmount, '1.1');
    const reservationRows = await pool.query(
      `SELECT event_id, event_type, amount::text AS amount, event_payload #>> '{money,amount}' AS amount_lexeme,
              amount_scale, financial_effect, reservation_id,
              reservation_authorization_event_id, supersedes_event_id
       FROM cost_intelligence.financial_ledger_events WHERE tenant_id = $1 AND project_id = $2 ORDER BY ingested_at, event_id`,
      [reservationScope.tenantId, reservationScope.projectId],
    );
    const originalGrant = reservationRows.rows.find(row => row.event_id === authorization.eventId);
    assert.equal(originalGrant.event_type, 'reservation_authorized');
    assert.equal(originalGrant.amount_lexeme, '1.00');
    assert.equal(originalGrant.amount, '1.000000000000000000', 'the numeric column stores the exact value independent of input display scale');
    assert.equal(originalGrant.amount_scale, 2);
    assert.equal(originalGrant.financial_effect, false);
    assert.equal(reservationRows.rows.find(row => row.event_id === finalOverrun.eventId).reservation_authorization_event_id, authorization.eventId);
    assert.equal(reservationRows.rows.find(row => row.event_id === finalOverrun.eventId).amount_lexeme, '1.10');
    assert.equal(reservationRows.rows.find(row => row.event_id === finalOverrun.eventId).supersedes_event_id, secondPartial.eventId);

    const authorizedDecrease = makeRequest(reservationScope, {
      ...consumptionOptions('0.30', 3, 'correction', finalOverrun.eventId, 'settled'),
      sourceRefs: [evidenceRef('authorized-reservation-decrease')],
    });
    await append(authorizedDecrease, reservationPorts);
    const correctedReservationProjection = await project(reservationScope, reservationPorts, '2026-10-11T03:02:00.000Z');
    assert.equal(amountRow(correctedReservationProjection, 'correction', 'direct_cost', 'USD').totalAmount, '0.3');
    const preservedGrant = await pool.query(
      `SELECT amount::text AS amount, event_payload #>> '{money,amount}' AS amount_lexeme,
              amount_scale, financial_effect FROM cost_intelligence.financial_ledger_events WHERE event_id = $1`,
      [authorization.eventId],
    );
    assert.equal(preservedGrant.rows[0].amount_lexeme, '1.00', 'linked decrease correction leaves the original 1.00 grant unchanged');
    assert.equal(preservedGrant.rows[0].amount_scale, 2);
    assert.equal(preservedGrant.rows[0].financial_effect, false);

    const reversalScope = makeScope('reversal-limit');
    const reversalPorts = makePorts(pool, reversalScope, clock);
    const originalCharge = makeRequest(reversalScope, { eventType: 'charge', amount: '1.00' });
    await append(originalCharge, reversalPorts);
    const reversal = (amount, label) => makeRequest(reversalScope, {
      eventType: 'reversal', amount, logicalOperationId: originalCharge.identities.logicalOperationId,
      sourceRefs: [evidenceRef(`reversal-${label}`)], reversesEventId: originalCharge.eventId,
    });
    await append(reversal('-0.40', 'partial-one'), reversalPorts);
    await append(reversal('-0.60', 'partial-two'), reversalPorts);
    await append(reversal('-0.01', 'over-limit'), reversalPorts, 'conflict');

    const auditScope = makeScope('append-only-audit');
    const auditPorts = makePorts(pool, auditScope, clock);
    const auditEvent = makeRequest(auditScope, { amount: '0.07' });
    await append(auditEvent, auditPorts);
    await assert.rejects(
      pool.query('UPDATE cost_intelligence.financial_ledger_events SET amount = 0 WHERE event_id = $1', [auditEvent.eventId]),
      error => error.code === '55000',
      'ordinary UPDATE must be rejected by the append-only trigger',
    );
    await assert.rejects(
      pool.query('DELETE FROM cost_intelligence.financial_ledger_events WHERE event_id = $1', [auditEvent.eventId]),
      error => error.code === '55000',
      'ordinary DELETE must be rejected by the append-only trigger',
    );

    const eventCounts = await pool.query(
      `SELECT count(*)::integer AS total FROM cost_intelligence.financial_ledger_events
       WHERE tenant_id = $1 AND project_id = $2`,
      [tinyScope.tenantId, tinyScope.projectId],
    );
    assert.equal(Number(eventCounts.rows[0].total), fixture.exact_money.count);
    await pool.end();
    const reconnected = new Pool({ ...databaseConfigFromEnvironment('CI_TEST_DB'), max: 4 });
    try {
      const durable = await reconnected.query(
        `SELECT count(*)::integer AS total FROM cost_intelligence.financial_ledger_events
         WHERE tenant_id = $1 AND project_id = $2`,
        [tinyScope.tenantId, tinyScope.projectId],
      );
      assert.equal(Number(durable.rows[0].total), fixture.exact_money.count, 'ledger events must remain durable after a fresh pool reconnect');
    } finally {
      await reconnected.end();
    }

    const fixtureBytes = await readFile(fixturePath);
    const evidencePath = join(root, 'artifacts/evidence/ci02-ledger-acceptance.json');
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify({
      evidence_version: '1.0.0',
      runtime: { node: process.version, postgres_server_version_num: postgresVersion, postgres_image: image.image },
      provenance: fixture.provenance,
      fixture: { path: 'fixtures/ledger/ci02-synthetic-acceptance.json', sha256: createHash('sha256').update(fixtureBytes).digest('hex') },
      assertions: {
        exact_1000_costs: fixture.exact_money.expected_total,
        independent_billable_attempts: fixture.billable_retries.expected_event_count,
        unknowns_remain_null: true,
        explicit_fx_source_and_time_retained_without_conversion: true,
        estimate_correction_effective: fixture.estimated_correction.effective,
        reservation_partial_replacement: fixture.cumulative_reservation.second_partial_effective,
        one_grant_per_reservation_identity: true,
        linked_final_overrun: fixture.cumulative_reservation.final_overrun,
        append_only_update_delete: '55000',
        deterministic_projection_rebuild: true,
        database_reconnect_durability: true,
        review_regressions: {
          R001_corrections_validate_current_financial_lineage: true,
          R002_reversals_follow_the_effective_economic_chain: true,
          R003_incomplete_known_usage_projects_a_null_total: true,
          R004_upstream_identity_status_is_explicit_without_fake_ids: true,
          R005_distinct_source_lines_map_to_one_attempt_without_double_posting: true,
          R006_cumulative_consumption_continues_after_evidenced_correction: true,
          R007_projection_snapshots_are_immutable_and_verified_on_reuse: true,
          R008_unsupported_payloads_use_scoped_hash_only_quarantine: true,
        },
      },
    }, null, 2)}\n`);
    completed = true;
  } finally {
    if (!completed) await pool.end().catch(() => {});
  }
});

test('CI02 issue 7 review regressions preserve lineage, reversals, partial usage, mappings, snapshots, and quarantine', async () => {
  assert.ok(process.env.CI_TEST_DB_HOST, 'ledger review regressions require the disposable PostgreSQL harness');
  const pool = new Pool({ ...databaseConfigFromEnvironment('CI_TEST_DB'), max: 24 });
  const clock = { value: fixedTime };
  try {
    const marker = await pool.query('SELECT marker FROM ci_test.disposable_database_marker');
    assertDisposableMarker(marker.rows);
    const server = await pool.query('SHOW server_version_num');
    assert.equal(String(server.rows[0].server_version_num).slice(0, 2), '16');

    const correctionScope = makeScope('review-correction-lineage');
    const correctionPorts = makePorts(pool, correctionScope, clock);
    const correctionBase = makeRequest(correctionScope, {
      amount: '1.00', logicalOperationId: 'review-correction-operation',
      sourceObjectId: 'review-correction-source', revisionSubjectId: 'review-correction-line',
      sourceEventId: 'review-correction-v0', sourceContentHash: contentHash('review-correction-v0'),
    });
    await append(correctionBase, correctionPorts);
    const invalidLineages = [
      { currency: 'EUR' },
      { classification: 'operating_expense' },
      { logicalOperationId: 'unrelated-correction-operation' },
      { postingMapping: {
        ...correctionBase.postingMapping,
        billableAttemptId: { status: 'known', id: 'unrelated-billable-attempt' },
      } },
    ];
    for (let index = 0; index < invalidLineages.length; index++) {
      const invalid = makeRequest(correctionScope, {
        eventType: 'correction', amount: '1.10', sourceObjectId: 'review-correction-source',
        revisionSubjectId: 'review-correction-line', sourceEventId: `review-correction-rejected-${index}`,
        sourceContentHash: contentHash(`review-correction-rejected-${index}`), revisionSequence: 1,
        supersedesEventId: correctionBase.eventId, sourceRefs: [evidenceRef(`review-correction-rejected-${index}`)],
        logicalOperationId: 'review-correction-operation', ...invalidLineages[index],
      });
      await append(invalid, correctionPorts, 'conflict');
    }
    const invalidSourceHead = await pool.query(
      `SELECT current_event_id FROM cost_intelligence.financial_source_revision_heads
       WHERE tenant_id = $1 AND project_id = $2 AND source_name = 'ci02-synthetic'
         AND source_object_id = 'review-correction-source' AND source_revision_subject_id = 'review-correction-line'`,
      [correctionScope.tenantId, correctionScope.projectId],
    );
    assert.equal(invalidSourceHead.rows[0].current_event_id, correctionBase.eventId, 'rejected corrections cannot advance a source head');
    const rejectedMappings = await pool.query(
      `SELECT count(*)::integer AS total FROM cost_intelligence.financial_posting_attempt_mappings
       WHERE tenant_id = $1 AND project_id = $2 AND source_object_id = 'review-correction-source'
         AND source_line_id = 'review-correction-line' AND source_revision_sequence = 1`,
      [correctionScope.tenantId, correctionScope.projectId],
    );
    assert.equal(rejectedMappings.rows[0].total, 0, 'a contradictory correction mapping must roll back with its event');

    const decreaseScope = makeScope('review-valid-decrease');
    const decreasePorts = makePorts(pool, decreaseScope, clock);
    const decreaseBase = makeRequest(decreaseScope, {
      amount: '1.00', logicalOperationId: 'review-valid-decrease-operation',
      sourceObjectId: 'review-valid-decrease-source', revisionSubjectId: 'review-valid-decrease-line',
      sourceEventId: 'review-valid-decrease-v0',
    });
    await append(decreaseBase, decreasePorts);
    const evidenceDecrease = makeRequest(decreaseScope, {
      eventType: 'correction', amount: '0.50', logicalOperationId: 'review-valid-decrease-operation',
      sourceObjectId: 'review-valid-decrease-source', revisionSubjectId: 'review-valid-decrease-line',
      sourceEventId: 'review-valid-decrease-v1', revisionSequence: 1, supersedesEventId: decreaseBase.eventId,
      sourceRefs: [evidenceRef('review-valid-decrease-proof')],
    });
    await append(evidenceDecrease, decreasePorts);
    assert.equal(amountRow(await project(decreaseScope, decreasePorts, '2026-10-11T03:02:00.000Z'), 'correction', 'direct_cost', 'USD').totalAmount, '0.5');

    const reservationLineageScope = makeScope('review-reservation-lineage');
    const reservationLineagePorts = makePorts(pool, reservationLineageScope, clock);
    const reservationOperation = 'review-reservation-operation';
    const reservationOne = randomId('review-reservation-one');
    const reservationTwo = randomId('review-reservation-two');
    const authorizationFor = async (reservationId, label) => {
      const request = makeRequest(reservationLineageScope, {
        eventType: 'reservation_authorized', classification: 'reservation_memo', financialEffect: false,
        reservationLifecycle: 'held', valuation: 'estimated', amount: '1.00', logicalOperationId: reservationOperation,
        identities: { reservationId }, sourceObjectId: `review-reservation-${label}`,
        revisionSubjectId: `review-authorization-${label}`, sourceEventId: `review-authorization-source-${label}`,
      });
      await append(request, reservationLineagePorts);
      return request;
    };
    const firstAuthorization = await authorizationFor(reservationOne, 'one');
    const secondAuthorization = await authorizationFor(reservationTwo, 'two');
    const linkedBase = makeRequest(reservationLineageScope, {
      amount: '0.80', logicalOperationId: reservationOperation, identities: { reservationId: reservationOne },
      reservationAuthorizationEventId: firstAuthorization.eventId,
      sourceObjectId: 'review-linked-source', revisionSubjectId: 'review-linked-line', sourceEventId: 'review-linked-v0',
    });
    await append(linkedBase, reservationLineagePorts);
    const dropReservationLink = makeRequest(reservationLineageScope, {
      eventType: 'correction', amount: '0.70', logicalOperationId: reservationOperation,
      sourceObjectId: 'review-linked-source', revisionSubjectId: 'review-linked-line', sourceEventId: 'review-linked-drop',
      revisionSequence: 1, supersedesEventId: linkedBase.eventId, sourceRefs: [evidenceRef('review-linked-drop-proof')],
    });
    await append(dropReservationLink, reservationLineagePorts, 'conflict');
    const switchReservationLink = makeRequest(reservationLineageScope, {
      eventType: 'correction', amount: '0.70', logicalOperationId: reservationOperation,
      identities: { reservationId: reservationTwo }, reservationAuthorizationEventId: secondAuthorization.eventId,
      sourceObjectId: 'review-linked-source', revisionSubjectId: 'review-linked-line', sourceEventId: 'review-linked-switch',
      revisionSequence: 1, supersedesEventId: linkedBase.eventId, sourceRefs: [evidenceRef('review-linked-switch-proof')],
    });
    await append(switchReservationLink, reservationLineagePorts, 'conflict');

    const memoScope = makeScope('review-memo-correction');
    const memoPorts = makePorts(pool, memoScope, clock);
    const memoOperation = 'review-memo-operation';
    const memoReservationId = randomId('review-memo-reservation');
    const memoAuthorization = makeRequest(memoScope, {
      eventType: 'reservation_authorized', classification: 'reservation_memo', financialEffect: false,
      reservationLifecycle: 'held', valuation: 'estimated', amount: '0.50', logicalOperationId: memoOperation,
      identities: { reservationId: memoReservationId }, sourceObjectId: 'review-memo-authorization',
      revisionSubjectId: 'review-memo-authorization-line', sourceEventId: 'review-memo-authorization-source',
    });
    await append(memoAuthorization, memoPorts);
    const dispatchMemo = makeRequest(memoScope, {
      eventType: 'dispatch', classification: 'reservation_memo', financialEffect: false,
      reservationLifecycle: 'dispatched', valuation: 'estimated', amount: '0.50', logicalOperationId: memoOperation,
      identities: { reservationId: memoReservationId }, reservationAuthorizationEventId: memoAuthorization.eventId,
      sourceObjectId: 'review-memo-dispatch', revisionSubjectId: 'review-memo-dispatch-line', sourceEventId: 'review-memo-dispatch-source',
    });
    await append(dispatchMemo, memoPorts);
    const financialCorrectionOfMemo = makeRequest(memoScope, {
      eventType: 'correction', classification: 'reservation_memo', amount: '0.60', logicalOperationId: memoOperation,
      identities: { reservationId: memoReservationId }, reservationAuthorizationEventId: memoAuthorization.eventId,
      sourceObjectId: 'review-memo-dispatch', revisionSubjectId: 'review-memo-dispatch-line', sourceEventId: 'review-memo-correction-source',
      revisionSequence: 1, supersedesEventId: dispatchMemo.eventId, sourceRefs: [evidenceRef('review-memo-correction-proof')],
    });
    await append(financialCorrectionOfMemo, memoPorts, 'conflict');

    const reversalScope = makeScope('review-reversal-graph');
    const reversalPorts = makePorts(pool, reversalScope, clock);
    const rootOperation = 'review-reversal-root-operation';
    const charge = makeRequest(reversalScope, {
      eventType: 'charge', amount: '1.00', logicalOperationId: rootOperation,
      sourceObjectId: 'review-reversal-root', revisionSubjectId: 'review-reversal-root-line', sourceEventId: 'review-reversal-root-v0',
    });
    await append(charge, reversalPorts);
    const chargeIncrease = makeRequest(reversalScope, {
      eventType: 'correction', amount: '1.10', logicalOperationId: rootOperation,
      sourceObjectId: 'review-reversal-root', revisionSubjectId: 'review-reversal-root-line', sourceEventId: 'review-reversal-root-v1',
      revisionSequence: 1, supersedesEventId: charge.eventId, sourceRefs: [evidenceRef('review-reversal-root-increase-proof')],
    });
    await append(chargeIncrease, reversalPorts);
    const reversalFor = (scope, amount, sourceObjectId, subjectId, sourceEventId, targetEventId, extra = {}) => makeRequest(scope, {
      eventType: 'reversal', amount, logicalOperationId: rootOperation, sourceObjectId,
      revisionSubjectId: subjectId, sourceEventId, reversesEventId: targetEventId,
      sourceRefs: [evidenceRef(`review-reversal-proof-${sourceEventId}`)], ...extra,
    });
    await append(reversalFor(reversalScope, '-0.10', 'review-stale-reversal', 'review-stale-line', 'review-stale-source', charge.eventId), reversalPorts, 'conflict');
    const partialReversal = reversalFor(reversalScope, '-0.40', 'review-reversal-child', 'review-reversal-line', 'review-reversal-v0', chargeIncrease.eventId);
    await append(partialReversal, reversalPorts);
    const chargeDecreaseAfterReversal = makeRequest(reversalScope, {
      eventType: 'correction', amount: '1.05', logicalOperationId: rootOperation,
      sourceObjectId: 'review-reversal-root', revisionSubjectId: 'review-reversal-root-line', sourceEventId: 'review-reversal-root-v2',
      revisionSequence: 2, supersedesEventId: chargeIncrease.eventId, sourceRefs: [evidenceRef('review-reversal-root-decrease-proof')],
    });
    await append(chargeDecreaseAfterReversal, reversalPorts);
    const rootBelowPriorReversal = makeRequest(reversalScope, {
      eventType: 'correction', amount: '0.30', logicalOperationId: rootOperation,
      sourceObjectId: 'review-reversal-root', revisionSubjectId: 'review-reversal-root-line', sourceEventId: 'review-reversal-root-v3',
      revisionSequence: 3, supersedesEventId: chargeDecreaseAfterReversal.eventId, sourceRefs: [evidenceRef('review-reversal-root-too-small-proof')],
    });
    await append(rootBelowPriorReversal, reversalPorts, 'conflict');
    const correctedReversal = makeRequest(reversalScope, {
      eventType: 'correction', amount: '-0.30', logicalOperationId: rootOperation,
      sourceObjectId: 'review-reversal-child', revisionSubjectId: 'review-reversal-line', sourceEventId: 'review-reversal-v1',
      revisionSequence: 1, supersedesEventId: partialReversal.eventId, sourceRefs: [evidenceRef('review-reversal-correction-proof')],
    });
    await append(correctedReversal, reversalPorts);
    await append(reversalFor(reversalScope, '-0.01', 'review-stale-reversal-correction', 'review-stale-correction-line', 'review-stale-correction-source', partialReversal.eventId), reversalPorts, 'conflict');
    const reversalOfReversal = reversalFor(reversalScope, '0.10', 'review-reversal-inverse', 'review-inverse-line', 'review-inverse-source', correctedReversal.eventId);
    await append(reversalOfReversal, reversalPorts);
    await append(reversalFor(reversalScope, '-0.86', 'review-reversal-overrun', 'review-overrun-line', 'review-overrun-source', reversalOfReversal.eventId), reversalPorts, 'conflict');
    const reversalProjection = await project(reversalScope, reversalPorts, '2026-10-11T03:02:00.000Z');
    assert.equal(amountRow(reversalProjection, 'correction', 'direct_cost', 'USD').totalAmount, '0.75');
    assert.equal(amountRow(reversalProjection, 'reversal', 'direct_cost', 'USD').totalAmount, '0.1');

    const memoReversalScope = makeScope('review-reversal-memo-target');
    const memoReversalPorts = makePorts(pool, memoReversalScope, clock);
    const memoTargetReservation = randomId('review-reversal-memo-reservation');
    const memoTargetOperation = 'review-reversal-memo-operation';
    const memoTargetAuthorization = makeRequest(memoReversalScope, {
      eventType: 'reservation_authorized', classification: 'reservation_memo', financialEffect: false,
      reservationLifecycle: 'held', valuation: 'estimated', amount: '0.50', logicalOperationId: memoTargetOperation,
      identities: { reservationId: memoTargetReservation }, sourceObjectId: 'review-reversal-memo-authorization',
      revisionSubjectId: 'review-reversal-memo-authorization-line', sourceEventId: 'review-reversal-memo-authorization-source',
    });
    await append(memoTargetAuthorization, memoReversalPorts);
    const memoTargetDispatch = makeRequest(memoReversalScope, {
      eventType: 'dispatch', classification: 'reservation_memo', financialEffect: false,
      reservationLifecycle: 'dispatched', valuation: 'estimated', amount: '0.50', logicalOperationId: memoTargetOperation,
      identities: { reservationId: memoTargetReservation }, reservationAuthorizationEventId: memoTargetAuthorization.eventId,
      sourceObjectId: 'review-reversal-memo-dispatch', revisionSubjectId: 'review-reversal-memo-dispatch-line', sourceEventId: 'review-reversal-memo-dispatch-source',
    });
    await append(memoTargetDispatch, memoReversalPorts);
    const reversalOfMemo = reversalFor(memoReversalScope, '-0.10', 'review-reversal-of-memo', 'review-reversal-of-memo-line', 'review-reversal-of-memo-source', memoTargetDispatch.eventId, {
      identities: { reservationId: memoTargetReservation }, reservationAuthorizationEventId: memoTargetAuthorization.eventId,
      classification: 'reservation_memo', logicalOperationId: memoTargetOperation,
    });
    await append(reversalOfMemo, makePorts(pool, memoReversalScope, clock), 'conflict');

    const concurrencyScope = makeScope('review-reversal-contention');
    const concurrencyPorts = makePorts(pool, concurrencyScope, clock);
    const concurrentCharge = makeRequest(concurrencyScope, { eventType: 'charge', amount: '1.00', logicalOperationId: 'review-concurrent-operation' });
    await append(concurrentCharge, concurrencyPorts);
    const concurrentReversal = (line) => reversalFor(concurrencyScope, '-0.60', `review-concurrent-${line}`, `review-concurrent-line-${line}`, `review-concurrent-source-${line}`, concurrentCharge.eventId, {
      logicalOperationId: 'review-concurrent-operation',
    });
    const reversalRace = await Promise.all([
      appendLedgerEvent(concurrentReversal('one'), concurrencyPorts),
      appendLedgerEvent(concurrentReversal('two'), concurrencyPorts),
    ]);
    assert.ok(reversalRace.every(result => result.ok));
    assert.deepEqual(reversalRace.map(result => result.ok ? result.value.status : 'error').sort(), ['accepted', 'conflict']);

    const correctionReversalRaceScope = makeScope('review-correction-reversal-contention');
    const correctionReversalRacePorts = makePorts(pool, correctionReversalRaceScope, clock);
    const raceOperation = 'review-correction-reversal-operation';
    const raceCharge = makeRequest(correctionReversalRaceScope, {
      eventType: 'charge', amount: '1.00', logicalOperationId: raceOperation,
      sourceObjectId: 'review-correction-reversal-root', revisionSubjectId: 'review-correction-reversal-root-line',
      sourceEventId: 'review-correction-reversal-v0',
    });
    await append(raceCharge, correctionReversalRacePorts);
    const raceCorrection = makeRequest(correctionReversalRaceScope, {
      eventType: 'correction', amount: '0.50', logicalOperationId: raceOperation,
      sourceObjectId: 'review-correction-reversal-root', revisionSubjectId: 'review-correction-reversal-root-line',
      sourceEventId: 'review-correction-reversal-v1', revisionSequence: 1, supersedesEventId: raceCharge.eventId,
      sourceRefs: [evidenceRef('review-correction-reversal-proof')],
    });
    const raceReversal = reversalFor(correctionReversalRaceScope, '-0.75', 'review-correction-reversal-child',
      'review-correction-reversal-line', 'review-correction-reversal-source', raceCharge.eventId, {
        logicalOperationId: raceOperation,
      });
    const correctionReversalRace = await Promise.all([
      appendLedgerEvent(raceCorrection, correctionReversalRacePorts),
      appendLedgerEvent(raceReversal, correctionReversalRacePorts),
    ]);
    assert.ok(correctionReversalRace.every(result => result.ok));
    assert.deepEqual(correctionReversalRace.map(result => result.ok ? result.value.status : 'error').sort(), ['accepted', 'conflict']);
    const raceProjection = await project(correctionReversalRaceScope, correctionReversalRacePorts, '2026-10-11T03:02:00.000Z');
    if (correctionReversalRace[0].ok && correctionReversalRace[0].value.status === 'accepted') {
      assert.equal(amountRow(raceProjection, 'correction', 'direct_cost', 'USD').totalAmount, '0.5');
      assert.equal(amountRow(raceProjection, 'reversal', 'direct_cost', 'USD'), undefined);
    } else {
      assert.equal(amountRow(raceProjection, 'charge', 'direct_cost', 'USD').totalAmount, '1');
      assert.equal(amountRow(raceProjection, 'reversal', 'direct_cost', 'USD').totalAmount, '-0.75');
      assert.equal(amountRow(raceProjection, 'correction', 'direct_cost', 'USD'), undefined);
    }

    const usageScope = makeScope('review-partial-usage');
    const usagePorts = makePorts(pool, usageScope, clock);
    await append(makeRequest(usageScope, {
      amount: '0.10', usage: { completeness: 'incomplete', missingFields: ['cached_tokens'], units: [
        { name: 'tokens', quantity: '100', scale: 0, relation: 'standalone' },
      ] },
    }), usagePorts);
    await append(makeRequest(usageScope, {
      amount: '0.10', usage: { completeness: 'incomplete', missingFields: ['cached_tokens'], units: [
        { name: 'tokens', quantity: '50', scale: 0, relation: 'standalone' },
        { name: 'cached_tokens', quantity: null, scale: 0, relation: 'included_subset', includedIn: 'tokens' },
      ] },
    }), usagePorts);
    await append(makeRequest(usageScope, {
      amount: '0.10', usage: { completeness: 'complete', missingFields: [], units: [
        { name: 'tokens', quantity: '10', scale: 0, relation: 'standalone' },
      ] },
    }), usagePorts);
    const partialUsage = await project(usageScope, usagePorts, '2026-10-11T03:02:00.000Z');
    const tokenQuantity = partialUsage.quantities.find(row => row.eventType === 'expense' && row.unitName === 'tokens');
    assert.equal(tokenQuantity.observationCount, 3);
    assert.equal(tokenQuantity.knownQuantityCount, 3);
    assert.equal(tokenQuantity.unknownQuantityCount, 0);
    assert.equal(tokenQuantity.incompleteObservationCount, 2);
    assert.equal(tokenQuantity.knownSubtotal, '160');
    assert.equal(tokenQuantity.totalQuantity, null);
    assert.equal(tokenQuantity.completeness, 'incomplete');
    const cachedTokens = partialUsage.quantities.find(row => row.eventType === 'expense' && row.unitName === 'cached_tokens');
    assert.equal(cachedTokens.knownQuantityCount, 0);
    assert.equal(cachedTokens.unknownQuantityCount, 1);
    assert.equal(cachedTokens.totalQuantity, null);
    assert.equal(cachedTokens.completeness, 'incomplete');

    const mappingScope = makeScope('review-source-line-mapping');
    const mappingPorts = makePorts(pool, mappingScope, clock);
    const mappingOperation = 'review-mapped-attempt-operation';
    const mappingBase = {
      schemaVersion: '1.0.0',
      sourceLineId: 'payment-principal-line',
      transportAttemptId: { status: 'known', id: 'mapped-transport-attempt' },
      providerAttemptId: { status: 'known', id: 'mapped-provider-attempt' },
      providerRequestId: { status: 'known', id: 'mapped-provider-request' },
      billableAttemptId: { status: 'known', id: 'mapped-billable-attempt' },
    };
    const principalLine = makeRequest(mappingScope, {
      eventType: 'charge', amount: '1.00', logicalOperationId: mappingOperation,
      sourceObjectId: 'review-payment-object', sourceEventId: 'review-payment-source-event', revisionSubjectId: 'payment-principal-line',
      postingMapping: mappingBase, sourceRefs: [evidenceRef('review-payment-principal')],
    });
    await append(principalLine, mappingPorts);
    const feeLine = makeRequest(mappingScope, {
      eventType: 'fee', amount: '0.10', logicalOperationId: mappingOperation,
      sourceObjectId: 'review-payment-object', sourceEventId: 'review-payment-source-event', revisionSubjectId: 'payment-fee-line',
      postingMapping: { ...mappingBase, sourceLineId: 'payment-fee-line' }, sourceRefs: [evidenceRef('review-payment-fee')],
    });
    await append(feeLine, mappingPorts);
    const exactReplay = await append(principalLine, mappingPorts, 'duplicate');
    assert.equal(exactReplay.existingEventId, principalLine.eventId);
    const alteredReplay = makeRequest(mappingScope, {
      eventType: 'charge', amount: '1.00', logicalOperationId: mappingOperation,
      sourceObjectId: 'review-payment-object', sourceEventId: 'review-payment-source-event', revisionSubjectId: 'payment-principal-line',
      sourceContentHash: principalLine.sourceIdentity.contentHash, revisionSequence: 0, postingMapping: mappingBase,
      eventId: randomId('review-payment-replay'), requestId: randomId('review-payment-request'),
      idempotencyKey: randomId('review-payment-idempotency'), correlationId: randomId('review-payment-correlation'),
      identities: { ...principalLine.identities, sourceObservationId: randomId('review-payment-observation') },
    });
    await append(alteredReplay, mappingPorts, 'stale_revision');
    const mappedRows = await pool.query(
      `SELECT event_id, source_line_id, mapping_version, logical_operation_id,
              transport_attempt_id, provider_attempt_id, provider_request_id, billable_attempt_id
       FROM cost_intelligence.financial_posting_attempt_mappings
       WHERE tenant_id = $1 AND project_id = $2 AND source_object_id = 'review-payment-object'
       ORDER BY source_line_id`,
      [mappingScope.tenantId, mappingScope.projectId],
    );
    assert.deepEqual(mappedRows.rows.map(row => row.source_line_id), ['payment-fee-line', 'payment-principal-line']);
    assert.ok(mappedRows.rows.every(row => row.mapping_version === '1.0.0'
      && row.transport_attempt_id === 'mapped-transport-attempt'
      && row.provider_attempt_id === 'mapped-provider-attempt'
      && row.provider_request_id === 'mapped-provider-request'
      && row.billable_attempt_id === 'mapped-billable-attempt'));
    const paymentProjection = await project(mappingScope, mappingPorts, '2026-10-11T03:02:00.000Z');
    assert.equal(amountRow(paymentProjection, 'charge', 'direct_cost', 'USD').totalAmount, '1');
    assert.equal(amountRow(paymentProjection, 'fee', 'direct_cost', 'USD').totalAmount, '0.1');
    assert.equal(paymentProjection.eventCount, 2, 'a genuine attempt can have separate principal and fee source lines');

    const retryScope = makeScope('review-explicit-retries');
    const retryPorts = makePorts(pool, retryScope, clock);
    const retryOperation = 'review-explicit-retry-operation';
    const retryObject = 'review-explicit-retry-object';
    const firstRetry = makeRequest(retryScope, {
      eventType: 'charge', amount: '0.02', logicalOperationId: retryOperation,
      sourceObjectId: retryObject, revisionSubjectId: 'retry-one', sourceEventId: 'retry-source-one',
      postingMapping: { ...makeRequest(retryScope, { logicalOperationId: retryOperation, revisionSubjectId: 'retry-one' }).postingMapping,
        sourceLineId: 'retry-one', billableAttemptId: { status: 'known', id: 'retry-billable-one' } },
    });
    const secondRetry = makeRequest(retryScope, {
      eventType: 'charge', amount: '0.03', logicalOperationId: retryOperation,
      sourceObjectId: retryObject, revisionSubjectId: 'retry-two', sourceEventId: 'retry-source-two',
      postingMapping: { ...makeRequest(retryScope, { logicalOperationId: retryOperation, revisionSubjectId: 'retry-two' }).postingMapping,
        sourceLineId: 'retry-two', billableAttemptId: { status: 'known', id: 'retry-billable-two' } },
    });
    await append(firstRetry, retryPorts);
    await append(secondRetry, retryPorts);
    const retryMappings = await pool.query(
      `SELECT DISTINCT billable_attempt_id FROM cost_intelligence.financial_posting_attempt_mappings
       WHERE tenant_id = $1 AND project_id = $2 AND logical_operation_id = $3 ORDER BY billable_attempt_id`,
      [retryScope.tenantId, retryScope.projectId, retryOperation],
    );
    assert.deepEqual(retryMappings.rows.map(row => row.billable_attempt_id), ['retry-billable-one', 'retry-billable-two']);
    assert.equal(amountRow(await project(retryScope, retryPorts, '2026-10-11T03:02:00.000Z'), 'charge', 'direct_cost', 'USD').totalAmount, '0.05');

    const unknownMappingScope = makeScope('review-upstream-statuses');
    const unknownMappingPorts = makePorts(pool, unknownMappingScope, clock);
    const notApplicable = { status: 'not_applicable' };
    const unknown = { status: 'unknown' };
    const manualSale = makeRequest(unknownMappingScope, {
      eventType: 'revenue', classification: 'sale', amount: '5.00', logicalOperationId: 'review-manual-sale',
      postingMapping: { schemaVersion: '1.0.0', sourceLineId: 'manual-sale-line', transportAttemptId: notApplicable,
        providerAttemptId: notApplicable, providerRequestId: notApplicable, billableAttemptId: notApplicable },
      sourceObjectId: 'review-manual-receipt', revisionSubjectId: 'manual-sale-line', sourceEventId: 'manual-sale-source',
      sourceRefs: [evidenceRef('review-manual-sale-source')],
    });
    await append(manualSale, unknownMappingPorts);
    const manualTax = makeRequest(unknownMappingScope, {
      eventType: 'tax', classification: 'pass_through_tax', amount: '0.40', logicalOperationId: 'review-manual-tax',
      postingMapping: { schemaVersion: '1.0.0', sourceLineId: 'manual-tax-line', transportAttemptId: notApplicable,
        providerAttemptId: notApplicable, providerRequestId: notApplicable, billableAttemptId: notApplicable },
      sourceObjectId: 'review-manual-receipt', revisionSubjectId: 'manual-tax-line', sourceEventId: 'manual-tax-source',
      sourceRefs: [evidenceRef('review-manual-tax-source')],
    });
    await append(manualTax, unknownMappingPorts);
    const unknownObservation = makeRequest(unknownMappingScope, {
      eventType: 'usage_observation', classification: 'usage_memo', valuation: 'unknown', amount: null,
      financialEffect: false, usage: { completeness: 'unknown', missingFields: ['tokens'], units: [] },
      logicalOperationId: 'review-resolved-usage-operation',
      postingMapping: { schemaVersion: '1.0.0', sourceLineId: 'usage-observation-line', transportAttemptId: unknown,
        providerAttemptId: unknown, providerRequestId: unknown, billableAttemptId: unknown },
      sourceObjectId: 'review-usage-observation', revisionSubjectId: 'usage-observation-line', sourceEventId: 'usage-observation-v0',
      sourceContentHash: contentHash('review-usage-observation-v0'), revisionSequence: 0,
    });
    await append(unknownObservation, unknownMappingPorts);
    const resolvedObservation = makeRequest(unknownMappingScope, {
      eventType: 'usage_observation', classification: 'usage_memo', valuation: 'unknown', amount: null,
      financialEffect: false, usage: { completeness: 'unknown', missingFields: ['tokens'], units: [] },
      logicalOperationId: 'review-resolved-usage-operation',
      postingMapping: { schemaVersion: '1.0.0', sourceLineId: 'usage-observation-line',
        transportAttemptId: { status: 'known', id: 'resolved-usage-transport' },
        providerAttemptId: { status: 'known', id: 'resolved-usage-provider' },
        providerRequestId: notApplicable, billableAttemptId: { status: 'known', id: 'resolved-usage-billable' } },
      sourceObjectId: 'review-usage-observation', revisionSubjectId: 'usage-observation-line', sourceEventId: 'usage-observation-v1',
      sourceContentHash: contentHash('review-usage-observation-v1'), revisionSequence: 1, supersedesEventId: unknownObservation.eventId,
    });
    await append(resolvedObservation, unknownMappingPorts);
    const upstreamRows = await pool.query(
      `SELECT event_type, transport_attempt_id, transport_attempt_status, provider_attempt_id, provider_attempt_status,
              provider_request_id, provider_request_status, billable_attempt_id, billable_attempt_status
       FROM cost_intelligence.financial_ledger_events WHERE tenant_id = $1 AND project_id = $2
       ORDER BY source_object_id, source_revision_sequence`,
      [unknownMappingScope.tenantId, unknownMappingScope.projectId],
    );
    assert.equal(upstreamRows.rows.find(row => row.event_type === 'revenue').transport_attempt_status, 'not_applicable');
    assert.equal(upstreamRows.rows.find(row => row.event_type === 'tax').provider_attempt_status, 'not_applicable');
    const usageStatusRows = upstreamRows.rows.filter(row => row.event_type === 'usage_observation');
    assert.equal(usageStatusRows.length, 2);
    assert.ok(usageStatusRows[0].transport_attempt_id === null && usageStatusRows[0].provider_attempt_id === null
      && usageStatusRows[0].provider_request_id === null && usageStatusRows[0].billable_attempt_id === null
      && usageStatusRows[0].transport_attempt_status === 'unknown' && usageStatusRows[0].provider_attempt_status === 'unknown'
      && usageStatusRows[0].provider_request_status === 'unknown' && usageStatusRows[0].billable_attempt_status === 'unknown');
    assert.equal(usageStatusRows[1].transport_attempt_id, 'resolved-usage-transport');
    assert.equal(usageStatusRows[1].provider_attempt_id, 'resolved-usage-provider');
    assert.equal(usageStatusRows[1].provider_request_id, null);
    assert.equal(usageStatusRows[1].provider_request_status, 'not_applicable');
    assert.equal(usageStatusRows[1].billable_attempt_id, 'resolved-usage-billable');

    const consumptionScope = makeScope('review-consumption-correction');
    const consumptionPorts = makePorts(pool, consumptionScope, clock);
    const consumptionOperation = 'review-consumption-operation';
    const consumptionReservationId = randomId('review-consumption-reservation');
    const consumptionAuthorization = makeRequest(consumptionScope, {
      eventType: 'reservation_authorized', classification: 'reservation_memo', financialEffect: false,
      reservationLifecycle: 'held', valuation: 'estimated', amount: '1.00', logicalOperationId: consumptionOperation,
      identities: { reservationId: consumptionReservationId }, sourceObjectId: 'review-consumption-authorization',
      revisionSubjectId: 'review-consumption-authorization-line', sourceEventId: 'review-consumption-authorization-source',
    });
    await append(consumptionAuthorization, consumptionPorts);
    const unrelatedConsumptionReservationId = randomId('review-unrelated-consumption-reservation');
    const unrelatedConsumptionOperation = 'review-unrelated-consumption-operation';
    const unrelatedConsumptionAuthorization = makeRequest(consumptionScope, {
      eventType: 'reservation_authorized', classification: 'reservation_memo', financialEffect: false,
      reservationLifecycle: 'held', valuation: 'estimated', amount: '0.50', logicalOperationId: unrelatedConsumptionOperation,
      identities: { reservationId: unrelatedConsumptionReservationId }, sourceObjectId: 'review-unrelated-consumption-authorization',
      revisionSubjectId: 'review-unrelated-consumption-authorization-line', sourceEventId: 'review-unrelated-consumption-authorization-source',
    });
    await append(unrelatedConsumptionAuthorization, consumptionPorts);
    await append(makeRequest(consumptionScope, {
      eventType: 'consumption', amount: '0.20', classification: 'direct_cost', logicalOperationId: unrelatedConsumptionOperation,
      identities: { reservationId: unrelatedConsumptionReservationId }, reservationAuthorizationEventId: unrelatedConsumptionAuthorization.eventId,
      reservationLifecycle: 'partially_settled', sourceObjectId: 'review-unrelated-consumption-source',
      revisionSubjectId: 'review-unrelated-consumption-line', sourceEventId: 'review-unrelated-consumption-v0',
    }), consumptionPorts);
    const consumptionOptions = (eventType, amount, sequence, supersedesEventId) => ({
      eventType, amount, classification: 'direct_cost', logicalOperationId: consumptionOperation,
      identities: { reservationId: consumptionReservationId }, reservationAuthorizationEventId: consumptionAuthorization.eventId,
      reservationLifecycle: 'partially_settled', sourceObjectId: 'review-consumption-source',
      revisionSubjectId: 'review-consumption-line', sourceEventId: `review-consumption-v${sequence}`,
      sourceContentHash: contentHash(`review-consumption-v${sequence}`), revisionSequence: sequence, supersedesEventId,
    });
    const consumptionPartial = makeRequest(consumptionScope, consumptionOptions('consumption', '0.60', 0, null));
    await append(consumptionPartial, consumptionPorts);
    const consumptionCorrection = makeRequest(consumptionScope, {
      ...consumptionOptions('correction', '0.30', 1, consumptionPartial.eventId),
      sourceRefs: [evidenceRef('review-consumption-correction-proof')],
    });
    await append(consumptionCorrection, consumptionPorts);
    const consumptionFinal = makeRequest(consumptionScope, consumptionOptions('consumption', '0.80', 2, consumptionCorrection.eventId));
    await append(consumptionFinal, consumptionPorts);
    await append(makeRequest(consumptionScope, consumptionOptions('consumption', '0.80', 3, consumptionPartial.eventId)), consumptionPorts, 'stale_revision');
    await append(makeRequest(consumptionScope, consumptionOptions('consumption', '0.70', 3, consumptionFinal.eventId)), consumptionPorts, 'conflict');
    const consumptionProjection = await project(consumptionScope, consumptionPorts, '2026-10-11T03:02:00.000Z');
    assert.equal(amountRow(consumptionProjection, 'consumption', 'direct_cost', 'USD').totalAmount, '1');
    assert.equal(amountRow(consumptionProjection, 'consumption', 'direct_cost', 'USD').eventCount, 2,
      'replacing one linked consumption chain must preserve an unrelated consumption line');
    const consumptionRows = await pool.query(
      `SELECT event_type, amount::text AS amount, event_payload #>> '{money,amount}' AS amount_lexeme,
              financial_effect, reservation_authorization_event_id
       FROM cost_intelligence.financial_ledger_events WHERE tenant_id = $1 AND project_id = $2
         AND source_object_id = 'review-consumption-source' ORDER BY source_revision_sequence`,
      [consumptionScope.tenantId, consumptionScope.projectId],
    );
    assert.deepEqual(consumptionRows.rows.map(row => row.event_type), ['consumption', 'correction', 'consumption']);
    assert.equal(consumptionRows.rows.length, 3, 'partial and corrected consumption remain as three immutable audit records');
    assert.equal(consumptionRows.rows[2].amount_lexeme, '0.80', 'the linked consumption chain replaces to its cumulative 0.80 value');
    assert.ok(consumptionRows.rows.every(row => row.financial_effect === true
      && row.reservation_authorization_event_id === consumptionAuthorization.eventId));

    const snapshotScope = makeScope('review-snapshot-immutability');
    const snapshotPorts = makePorts(pool, snapshotScope, clock);
    await append(makeRequest(snapshotScope, {
      amount: '0.40', usage: { completeness: 'complete', missingFields: [], units: [
        { name: 'tokens', quantity: '25', scale: 0, relation: 'standalone' },
      ] },
    }), snapshotPorts);
    const snapshotRequest = { schemaVersion: '1.0.0', requestId: randomId('snapshot-request'), scope: snapshotScope, asOf: '2026-10-11T03:02:00.000Z' };
    const snapshot = await project(snapshotScope, snapshotPorts, snapshotRequest.asOf);
    await project(snapshotScope, snapshotPorts, snapshotRequest.asOf);
    const persistedSnapshot = await pool.query(
      `SELECT snapshot_id, tenant_id, project_id, event_count, projection_hash
       FROM cost_intelligence.financial_projection_snapshots WHERE snapshot_id = $1`, [snapshot.snapshotId],
    );
    assert.equal(persistedSnapshot.rows[0].projection_hash, snapshot.projectionHash);
    assert.equal(Number(persistedSnapshot.rows[0].event_count), snapshot.eventCount);
    const persistedSnapshotAmounts = await pool.query(
      `SELECT event_type, classification, currency, event_count, known_amount_count, unknown_amount_count,
              known_subtotal::text AS known_subtotal, total_amount::text AS total_amount, amount_completeness
       FROM cost_intelligence.financial_projection_amounts WHERE snapshot_id = $1`, [snapshot.snapshotId],
    );
    assert.deepEqual(persistedSnapshotAmounts.rows.map(row => ({
      eventType: row.event_type, classification: row.classification, currency: row.currency.trim(),
      eventCount: Number(row.event_count), knownAmountCount: Number(row.known_amount_count),
      unknownAmountCount: Number(row.unknown_amount_count), knownSubtotal: normalizeDecimal(row.known_subtotal),
      totalAmount: normalizeDecimal(row.total_amount), completeness: row.amount_completeness,
    })), snapshot.amounts);
    const persistedSnapshotQuantities = await pool.query(
      `SELECT event_type, classification, currency, unit_name, relation, observation_count,
              known_quantity_count, unknown_quantity_count, incomplete_observation_count,
              known_subtotal::text AS known_subtotal, total_quantity::text AS total_quantity, quantity_completeness
       FROM cost_intelligence.financial_projection_quantities WHERE snapshot_id = $1`, [snapshot.snapshotId],
    );
    assert.deepEqual(persistedSnapshotQuantities.rows.map(row => ({
      eventType: row.event_type, classification: row.classification, currency: row.currency.trim(),
      unitName: row.unit_name, relation: row.relation,
      observationCount: Number(row.observation_count), knownQuantityCount: Number(row.known_quantity_count),
      unknownQuantityCount: Number(row.unknown_quantity_count), incompleteObservationCount: Number(row.incomplete_observation_count),
      knownSubtotal: normalizeDecimal(row.known_subtotal), totalQuantity: normalizeDecimal(row.total_quantity),
      completeness: row.quantity_completeness,
    })), snapshot.quantities);
    const reconnectPool = new Pool({ ...databaseConfigFromEnvironment('CI_TEST_DB'), max: 2 });
    try {
      const reconnectSnapshot = await project(snapshotScope, makePorts(reconnectPool, snapshotScope, clock), snapshotRequest.asOf);
      assert.equal(reconnectSnapshot.projectionHash, snapshot.projectionHash);
      assert.deepEqual(reconnectSnapshot.amounts, snapshot.amounts);
      assert.deepEqual(reconnectSnapshot.quantities, snapshot.quantities);
    } finally {
      await reconnectPool.end();
    }

    const snapshotRaceScope = makeScope('review-snapshot-contention');
    const snapshotRacePorts = makePorts(pool, snapshotRaceScope, clock);
    await append(makeRequest(snapshotRaceScope, { amount: '0.05' }), snapshotRacePorts);
    const snapshotRaceRequest = { schemaVersion: '1.0.0', requestId: randomId('snapshot-race'), scope: snapshotRaceScope, asOf: '2026-10-11T03:02:00.000Z' };
    const concurrentSnapshots = await Promise.all([
      rebuildLedgerProjection({ ...snapshotRaceRequest, requestId: randomId('snapshot-race-request') }, snapshotRacePorts),
      rebuildLedgerProjection({ ...snapshotRaceRequest, requestId: randomId('snapshot-race-request') }, snapshotRacePorts),
    ]);
    assert.ok(concurrentSnapshots.every(result => result.ok),
      `concurrent snapshot result codes: ${JSON.stringify(concurrentSnapshots.map(result => result.ok ? 'ok' : result.error.code))}`);
    const concurrentHashes = concurrentSnapshots.map(result => result.ok ? result.value.projectionHash : 'error');
    assert.equal(concurrentHashes[0], concurrentHashes[1]);
    const concurrentSnapshotCount = await pool.query(
      `SELECT count(*)::integer AS total FROM cost_intelligence.financial_projection_snapshots
       WHERE tenant_id = $1 AND project_id = $2`,
      [snapshotRaceScope.tenantId, snapshotRaceScope.projectId],
    );
    assert.equal(concurrentSnapshotCount.rows[0].total, 1);
    await assert.rejects(pool.query(
      'UPDATE cost_intelligence.financial_projection_snapshots SET event_count = event_count WHERE snapshot_id = $1', [snapshot.snapshotId],
    ), error => error.code === '55000');
    await assert.rejects(pool.query(
      'DELETE FROM cost_intelligence.financial_projection_snapshots WHERE snapshot_id = $1', [snapshot.snapshotId],
    ), error => error.code === '55000');
    await assert.rejects(pool.query(
      'UPDATE cost_intelligence.financial_projection_amounts SET event_count = event_count WHERE snapshot_id = $1', [snapshot.snapshotId],
    ), error => error.code === '55000');
    await assert.rejects(pool.query(
      'DELETE FROM cost_intelligence.financial_projection_amounts WHERE snapshot_id = $1', [snapshot.snapshotId],
    ), error => error.code === '55000');
    await assert.rejects(pool.query(
      'UPDATE cost_intelligence.financial_projection_quantities SET observation_count = observation_count WHERE snapshot_id = $1', [snapshot.snapshotId],
    ), error => error.code === '55000');
    await assert.rejects(pool.query(
      'DELETE FROM cost_intelligence.financial_projection_quantities WHERE snapshot_id = $1', [snapshot.snapshotId],
    ), error => error.code === '55000');
    await pool.query('ALTER TABLE cost_intelligence.financial_projection_amounts DISABLE TRIGGER financial_projection_amounts_append_only');
    try {
      await pool.query(
        `UPDATE cost_intelligence.financial_projection_amounts SET known_subtotal = known_subtotal + 0.01
         WHERE snapshot_id = $1`, [snapshot.snapshotId],
      );
    } finally {
      await pool.query('ALTER TABLE cost_intelligence.financial_projection_amounts ENABLE TRIGGER financial_projection_amounts_append_only');
    }
    const corruptReuse = await rebuildLedgerProjection(snapshotRequest, snapshotPorts);
    assert.equal(corruptReuse.ok, false, 'a reused snapshot with altered persisted rows must fail closed');
    if (!corruptReuse.ok) assert.equal(corruptReuse.error.code, 'SOURCE_UNAVAILABLE');

    const quarantineScope = makeScope('review-quarantine');
    const quarantinePorts = makePorts(pool, quarantineScope, clock);
    const unsupportedVersion = makeRequest(quarantineScope, { eventId: 'unsupported-version-event', amount: '99.99' });
    unsupportedVersion.schemaVersion = '9.9.9';
    unsupportedVersion.privatePrompt = 'PROMPT_CANARY_CI02_PRIVATE_ONLY';
    unsupportedVersion.privateAddress = 'ADDRESS_CANARY_CI02_PRIVATE_ONLY';
    unsupportedVersion.privateHeader = 'HEADER_CANARY_CI02_PRIVATE_ONLY';
    const quarantinedVersion = await appendLedgerEvent(unsupportedVersion, quarantinePorts);
    assert.equal(quarantinedVersion.ok, false);
    if (!quarantinedVersion.ok) {
      assert.equal(quarantinedVersion.error.code, 'UNSUPPORTED_VERSION');
      assert.match(quarantinedVersion.error.diagnostic_ref, /^ci02q:[a-f0-9]{64}$/);
    }
    const versionReplay = await appendLedgerEvent(unsupportedVersion, quarantinePorts);
    assert.equal(versionReplay.ok, false);
    if (!versionReplay.ok) assert.equal(versionReplay.error.diagnostic_ref, quarantinedVersion.error.diagnostic_ref);
    const unsupportedType = makeRequest(quarantineScope, { eventId: 'unsupported-type-event', amount: '77.77' });
    unsupportedType.eventType = 'unsupported_PRIVATE_TYPE_CANARY';
    unsupportedType.privatePrompt = 'PROMPT_CANARY_CI02_PRIVATE_ONLY';
    unsupportedType.privateAddress = 'ADDRESS_CANARY_CI02_PRIVATE_ONLY';
    unsupportedType.privateHeader = 'HEADER_CANARY_CI02_PRIVATE_ONLY';
    const quarantinedType = await appendLedgerEvent(unsupportedType, quarantinePorts);
    assert.equal(quarantinedType.ok, false);
    if (!quarantinedType.ok) {
      assert.equal(quarantinedType.error.code, 'VALIDATION_ERROR');
      assert.match(quarantinedType.error.diagnostic_ref, /^ci02q:[a-f0-9]{64}$/);
    }
    const quarantineRows = await pool.query(
      `SELECT diagnostic_ref, tenant_id, project_id, environment, billing_mode, unsupported_schema_version, reason_code, payload_sha256
       FROM cost_intelligence.financial_ledger_quarantine WHERE tenant_id = $1 AND project_id = $2 ORDER BY reason_code`,
      [quarantineScope.tenantId, quarantineScope.projectId],
    );
    assert.equal(quarantineRows.rows.length, 2);
    const quarantineText = JSON.stringify(quarantineRows.rows);
    assert.ok(!quarantineText.includes('PROMPT_CANARY_CI02_PRIVATE_ONLY'));
    assert.ok(!quarantineText.includes('ADDRESS_CANARY_CI02_PRIVATE_ONLY'));
    assert.ok(!quarantineText.includes('HEADER_CANARY_CI02_PRIVATE_ONLY'));
    assert.ok(!quarantineText.includes('unsupported_PRIVATE_TYPE_CANARY'));
    assert.equal(quarantineRows.rows.find(row => row.reason_code === 'unsupported_schema_version').unsupported_schema_version, '9.9.9');
    assert.equal(quarantineRows.rows.find(row => row.reason_code === 'unsupported_event_type').unsupported_schema_version, null);
    const quarantinedEvents = await pool.query(
      `SELECT count(*)::integer AS total FROM cost_intelligence.financial_ledger_events
       WHERE tenant_id = $1 AND project_id = $2`,
      [quarantineScope.tenantId, quarantineScope.projectId],
    );
    assert.equal(quarantinedEvents.rows[0].total, 0, 'unsupported payloads cannot create financial or ledger events');

    const forbiddenScope = makeScope('review-quarantine-forbidden');
    let forbiddenConnects = 0;
    const forbiddenPorts = {
      ...makePorts(pool, forbiddenScope, clock),
      trustedContext: { resolve: async () => null },
      database: { connect: async () => { forbiddenConnects++; return pool.connect(); } },
    };
    const forbiddenPayload = makeRequest(forbiddenScope, { eventId: 'forbidden-quarantine-event' });
    forbiddenPayload.schemaVersion = '9.9.9';
    const forbiddenQuarantine = await appendLedgerEvent(forbiddenPayload, forbiddenPorts);
    assert.equal(forbiddenQuarantine.ok, false);
    if (!forbiddenQuarantine.ok) assert.equal(forbiddenQuarantine.error.code, 'FORBIDDEN_SCOPE');
    assert.equal(forbiddenConnects, 0, 'an unauthorized quarantine request cannot open a persistence connection');
    const forbiddenRows = await pool.query(
      `SELECT count(*)::integer AS total FROM cost_intelligence.financial_ledger_quarantine
       WHERE tenant_id = $1 AND project_id = $2`,
      [forbiddenScope.tenantId, forbiddenScope.projectId],
    );
    assert.equal(forbiddenRows.rows[0].total, 0);
  } finally {
    await pool.end().catch(() => {});
  }
});
