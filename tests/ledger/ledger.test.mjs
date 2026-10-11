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
  const identities = options.identities ?? {};
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
      logicalOperationId: identities.logicalOperationId ?? options.logicalOperationId ?? randomId('operation'),
      transportAttemptId: identities.transportAttemptId ?? randomId('transport'),
      providerAttemptId: identities.providerAttemptId ?? randomId('provider-attempt'),
      providerRequestId: Object.hasOwn(identities, 'providerRequestId') ? identities.providerRequestId : null,
      billableAttemptId: identities.billableAttemptId ?? options.billableAttemptId ?? randomId('billable'),
      sourceObservationId: identities.sourceObservationId ?? randomId('observation'),
      reservationId: Object.hasOwn(identities, 'reservationId') ? identities.reservationId : null,
    },
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
  assert.equal(result.value.status, expectedStatus);
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
        transportAttemptId: randomId('transport-race'), providerAttemptId: randomId('provider-race'),
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
      eventType: 'reversal', amount, sourceRefs: [evidenceRef(`reversal-${label}`)], reversesEventId: originalCharge.eventId,
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
      },
    }, null, 2)}\n`);
    completed = true;
  } finally {
    if (!completed) await pool.end().catch(() => {});
  }
});
