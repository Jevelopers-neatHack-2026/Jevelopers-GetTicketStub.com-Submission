// Model-only SQL transport/authority scheduling checks; not PostgreSQL/RLS evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresEvidenceReader, validateLedgerAppendRequestBoundary } from '../../dist/index.js';
import { clock, now, decision, row, scope, postingRequest, reverseRequest, ledgerRequest, checked, refused } from './postgres-fixtures.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('actual-PostgreSQL synthetic seed requests satisfy the public append boundary', () => {
  for (const options of [{}, { eventType: 'usage_observation' }]) {
    const result = validateLedgerAppendRequestBoundary(ledgerRequest(scope(), options));
    assert.equal(result.ok, true, JSON.stringify(result));
  }
});

function model(overrides = {}) {
  const state = { queries: [], calls: [], releases: [], discards: 0, connections: 0, committed: false, dataReads: 0,
    quarantined: false, restrictedRole: true, healthy: true, revision: 'revision-1', denied: false,
    rows: [row(), row(scope(), { event_id: 'evt-observation', event_type: 'usage_observation', classification: 'usage_memo', financial_effect: false, source_observation_id: 'observation-usage' })],
    ...overrides };
  const client = {
    release() { state.releases.push(false); },
    discard() { state.discards++; },
    async query(sql, parameters = []) {
      state.queries.push({ sql, parameters: structuredClone(parameters) });
      await state.beforeQuery?.(sql, parameters, state);
      let rows = [];
      if (sql.includes('FROM pg_roles')) rows = [{ restricted: state.restrictedRole }];
      else if (sql.includes('evidence_reader_health')) rows = [{ migrations_ready: state.healthy }];
      else if (sql.includes('AS restricted FROM cost_intelligence.financial_privacy_quarantine')) rows = state.quarantined ? [{ restricted: 1 }] : [];
      else if (sql.startsWith('SELECT e.tenant_id')) {
        state.dataReads++;
        rows = state.rows.filter(value => value.tenant_id === parameters[0] && value.project_id === parameters[1]
          && value.environment === parameters[2] && value.billing_mode === parameters[3]);
        if (sql.includes('AND e.event_id=$5')) rows = rows.filter(value => value.event_id === parameters[4]);
        else if (sql.includes("AND e.logical_operation_id=$5 AND e.event_type='usage_observation'")) rows = rows.filter(value => value.logical_operation_id === parameters[4] && value.event_type === 'usage_observation');
        rows = rows.toSorted((a, b) => a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0).slice(0, parameters.at(-1));
      } else if (sql === 'COMMIT') state.committed = true;
      const result = { rows };
      await state.afterQuery?.(sql, parameters, state, result);
      return result;
    },
  };
  const ports = { clock, database: { async connect() { state.connections++; return state.acquire ? state.acquire(client) : client; } },
    financeAuthority: { async authorizeCurrent(input) {
      state.calls.push({ committed: state.committed, dataReads: state.dataReads, lastSql: state.queries.at(-1)?.sql });
      if (state.authority) return state.authority(input, state);
      if (state.denied) return { status: 'denied', operation: input.operation, permission: input.permission };
      return decision(input, state.revision);
    } } };
  return { state, client, ports, reader: createPostgresEvidenceReader(ports) };
}

test('PostgreSQL reader composes a private scoped read-only lookup and preserves revision0', async () => {
  const h = model();
  assert.equal(h.state.connections, 0, 'factory does not acquire a client');
  assert.deepEqual(Object.keys(h.reader).sort(), ['lookupByOperationalReference', 'lookupPostingEvidence']);
  const result = await checked(h.reader.lookupPostingEvidence(postingRequest()));
  assert.equal(result.posting.eventId, 'evt-posting');
  assert.deepEqual(result.sourceObservations.map(value => value.eventId), ['evt-observation']);
  assert.equal(result.rateRule.rateCardRef.revision, 0);
  assert.equal(result.billingAuthority, false);
  assert.deepEqual(h.state.releases, [false]);
  assert.equal(h.state.queries[0].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
  assert.equal(h.state.queries.at(-1).sql, 'COMMIT');
  assert.equal(h.state.calls.some(call => call.committed), false, 'no authority await after releasing partition gate');
  const gate = h.state.queries.findIndex(entry => entry.sql.includes('pg_advisory_xact_lock'));
  const reads = h.state.queries.filter(entry => entry.sql.startsWith('SELECT e.tenant_id'));
  assert.ok(gate > 0 && gate < h.state.queries.indexOf(reads[0]));
  for (const read of reads) {
    assert.deepEqual(read.parameters.slice(0, 4), ['ci10-tenant', 'ci10-project', 'test', 'simulated']);
    assert.equal(/\bevent_payload\b|\bamount\b|SELECT\s+\*/i.test(read.sql), false);
  }
  assert.ok(h.state.queries.some(entry => entry.sql === "SET LOCAL idle_in_transaction_session_timeout='5000ms'"));
});

test('invalid and unsupported references open no connection; native namespace is explicit', async () => {
  for (const request of [null, postingRequest(scope(), 'https://secret.invalid'), reverseRequest('trace', 'trace-1', 'neatlogs')]) {
    const h = model();
    await refused(request?.reference ? h.reader.lookupByOperationalReference(request) : h.reader.lookupPostingEvidence(request), 'VALIDATION_ERROR');
    assert.equal(h.state.connections, 0);
  }
  for (const kind of ['correlation', 'workflow', 'job']) for (const namespace of ['neatlogs', 'entire']) {
    const h = model();
    await refused(h.reader.lookupByOperationalReference(reverseRequest(kind, 'same-native-id', namespace)));
    assert.equal(h.state.connections, 0, 'foreign vocabulary is not a native lookup or native truncation side channel');
    assert.equal(h.state.calls.length, 1, 'valid but unavailable foreign mapping still requires current access');
  }
});

test('denied access never acquires a client; privilege and feature-health failures never read a posting', async () => {
  const denied = model({ denied: true });
  await refused(denied.reader.lookupPostingEvidence(postingRequest()), 'FORBIDDEN_SCOPE');
  assert.equal(denied.state.connections, 0);
  for (const override of [{ restrictedRole: false }, { healthy: false }, { quarantined: true }]) {
    const h = model(override);
    await refused(h.reader.lookupPostingEvidence(postingRequest()));
    assert.equal(h.state.dataReads, 0);
    assert.equal(h.state.queries.at(-1).sql, 'ROLLBACK');
  }
});

for (const fault of ['quarantine', 'query', 'malformed']) {
  test(`${fault} after a successful posting read suppresses all retained evidence`, async () => {
    const h = model({ afterQuery(sql, _parameters, state, result) {
      if (!sql.startsWith('SELECT e.tenant_id')) return;
      if (fault === 'quarantine' && state.dataReads === 1) state.quarantined = true;
      if (state.dataReads === 2) {
        if (fault === 'query') throw new Error('postgres://PRIVATE_QUERY_ERROR');
        if (fault === 'malformed') result.rows = [{ nested: { private: 'DO_NOT_DISCLOSE' } }];
      }
    } });
    const result = await refused(h.reader.lookupPostingEvidence(postingRequest()));
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(h.state.committed, false);
    assert.ok(h.state.queries.some(entry => entry.sql === 'ROLLBACK'));
    assert.equal(h.state.dataReads, fault === 'quarantine' ? 1 : 2);
  });
}

test('final fresh privacy observation suppresses a completed projection', async () => {
  const h = model({ authority(input, state) {
    if (state.dataReads === 2) state.quarantined = true;
    return decision(input);
  } });
  await refused(h.reader.lookupPostingEvidence(postingRequest()));
  assert.equal(h.state.dataReads, 2);
  assert.equal(h.state.committed, false);
});

test('authorization is renewed after a failed database read and denial keeps its safe code', async () => {
  const h = model({ afterQuery(sql, _parameters, state) {
    if (sql.startsWith('SELECT e.tenant_id')) { state.denied = true; throw new Error('PRIVATE_DRIVER_FAILURE'); }
  } });
  await refused(h.reader.lookupPostingEvidence(postingRequest()), 'FORBIDDEN_SCOPE');
  assert.deepEqual(h.state.releases, []);
  assert.equal(h.state.discards, 1);
});

test('wrong stored JSON types and inexact revisions cannot become valid-looking evidence', async () => {
  for (const changes of [
    { provider: '123', provider_type: 'number' }, { workflow_id: 'true', workflow_type: 'boolean' },
    { job_id: '17', job_type: 'number' }, { policy_version: '4', policy_version_type: 'number' },
    { rule_version: 'false', rule_version_type: 'boolean' }, { rate_card_id: '23', rate_card_id_type: 'number' },
    { rate_card_revision: '1', rate_card_revision_type: 'string' },
    { rate_card_revision: '9007199254740991.1' }, { rate_card_revision: '9007199254740992' }, { rate_card_revision: '0.1' },
  ]) {
    const h = model({ rows: [row(scope(), changes)] });
    await refused(h.reader.lookupPostingEvidence(postingRequest()));
    assert.equal(h.state.committed, false);
  }
  const h = model({ rows: [row(scope(), { rate_card_revision: '0.0' })] });
  assert.equal((await checked(h.reader.lookupPostingEvidence(postingRequest()))).rateRule.rateCardRef.revision, 0);
});

test('provider and arbitrary correlation references remain exact namespaced links with bounded results', async () => {
  const records = Array.from({ length: 51 }, (_, index) => row(scope(), { event_id: `evt-${String(index).padStart(2, '0')}` }));
  const h = model({ rows: records });
  const result = await checked(h.reader.lookupByOperationalReference(reverseRequest('provider_request', 'request-1', 'provider:openai')));
  assert.equal(result.matches.length, 50);
  assert.ok(result.gaps.includes('result_limit_reached'));
  assert.ok(result.gaps.includes('correlation_only_match'));
  const query = h.state.queries.find(entry => entry.sql.startsWith('SELECT e.tenant_id'));
  assert.ok(query.sql.includes("provider_request_status='known' AND e.provider_request_id=$5 AND lower(e.dimensions->>'provider')=$6"));
  assert.deepEqual(query.parameters.slice(4), ['request-1', 'openai', 51]);
  assert.equal(result.billingAuthority, false);
});

test('caller and store aliases cannot replace previously captured scope or fields', async () => {
  const request = postingRequest();
  const h = model({ afterQuery(sql, _parameters, state) {
    if (sql.startsWith('SELECT e.tenant_id') && state.dataReads === 2) state.rows[0].event_id = 'substituted-event';
  }, authority(input) {
    request.scope.tenantId = 'substituted-tenant'; request.eventId = 'substituted-event';
    return decision(input);
  } });
  const result = await checked(h.reader.lookupPostingEvidence(request));
  assert.equal(result.posting.eventId, 'evt-posting');
  assert.ok(h.state.queries.filter(entry => entry.sql.startsWith('SELECT e.tenant_id')).every(entry => entry.parameters[0] === 'ci10-tenant'));
});

for (const lookup of ['lookupPostingEvidence', 'lookupByOperationalReference']) {
  test(`${lookup} uses one principal pin despite retained raw authority mutation`, async () => {
    for (const hops of [0, 2, 3, 4]) {
      let retained; const issued = []; let mutations = 0;
      const later = count => queueMicrotask(() => { if (count > 1) later(count - 1); else { retained.principal.serviceGrantRevision = 'fixed-alias'; mutations++; } });
      const h = model({ authority(input) {
        retained ??= decision(input);
        const revision = `issued-${issued.length + 1}`; issued.push(revision);
        retained.principal.serviceGrantRevision = revision;
        if (hops) later(hops);
        return retained;
      } });
      await refused(h.reader[lookup](lookup === 'lookupPostingEvidence' ? postingRequest() : reverseRequest()), 'FORBIDDEN_SCOPE');
      await flush();
      assert.deepEqual(issued, ['issued-1', 'issued-2']);
      assert.equal(mutations, hops ? 2 : 0);
      assert.equal(h.state.dataReads, 0);
    }
  });
}

test('stalled authority under the partition gate times out, rolls back and cannot resume', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let late;
  const h = model({ authority(input, state) {
    const result = decision(input);
    if (state.queries.some(entry => entry.sql.includes('pg_advisory_xact_lock'))) return new Promise(resolve => { late = () => resolve(result); });
    return result;
  } });
  const pending = h.reader.lookupPostingEvidence(postingRequest());
  await flush(); assert.equal(typeof late, 'function');
  t.mock.timers.tick(2_001);
  await refused(pending);
  const before = h.state.queries.length;
  assert.equal(h.state.queries.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(h.state.releases, [false]);
  late(); await flush();
  assert.equal(h.state.queries.length, before);
  assert.equal(h.state.dataReads, 0);
  assert.equal(h.state.committed, false);
});

test('late pool acquisition is released exactly once without BEGIN', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let late;
  const h = model({ acquire: client => new Promise(resolve => { late = () => resolve(client); }) });
  const pending = h.reader.lookupPostingEvidence(postingRequest());
  await flush(); assert.equal(typeof late, 'function');
  t.mock.timers.tick(5_001); await refused(pending);
  assert.deepEqual(h.state.queries, []); assert.deepEqual(h.state.releases, []);
  late(); await flush();
  assert.deepEqual(h.state.queries, []); assert.deepEqual(h.state.releases, [false]);
});

test('synchronous rollback failure and rejected COMMIT evict the connection without exposing errors', async () => {
  for (const failure of ['rollback', 'commit']) {
    const h = model({ beforeQuery(sql) { if (failure === 'commit' && sql === 'COMMIT') throw new Error('PRIVATE_COMMIT'); } });
    if (failure === 'rollback') {
      const query = h.client.query.bind(h.client);
      h.client.query = (sql, ...args) => { if (sql === 'ROLLBACK') throw new Error('PRIVATE_ROLLBACK'); return query(sql, ...args); };
      h.state.healthy = false;
    }
    const result = await refused(h.reader.lookupPostingEvidence(postingRequest()));
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.deepEqual(h.state.releases, []);
    assert.equal(h.state.discards, 1);
  }
});

test('legacy client without an explicit discard capability is released idle before BEGIN', async () => {
  const h = model();
  delete h.client.discard;
  await refused(h.reader.lookupPostingEvidence(postingRequest()));
  assert.deepEqual(h.state.queries, []);
  assert.deepEqual(h.state.releases, [false]);
  assert.equal(h.state.discards, 0);
});

for (const lookup of ['lookupPostingEvidence', 'lookupByOperationalReference']) {
  for (const boundary of ['final-privacy', 'commit']) {
    for (const fault of ['expired', 'stale', 'clock-regression', 'invalid-clock']) {
      test(`${lookup} refuses ${fault} authority at ${boundary} without disclosing retained evidence`, async () => {
        const start = Date.parse(now);
        let instant = start;
        let triggered = false;
        const h = model({ authority(input) {
          return { ...decision(input), expiresAt: new Date(start + (fault === 'stale' ? 300_000 : 60_000)).toISOString() };
        }, afterQuery(sql, _parameters, state) {
          const finalPrivacy = sql.includes('AS restricted FROM cost_intelligence.financial_privacy_quarantine')
            && state.dataReads === (lookup === 'lookupPostingEvidence' ? 2 : 1);
          if ((boundary === 'commit' && sql === 'COMMIT') || (boundary === 'final-privacy' && finalPrivacy)) {
            triggered = true;
            instant = fault === 'clock-regression' ? start - 1 : fault === 'invalid-clock' ? NaN
              : start + (fault === 'expired' ? 60_000 : 60_001);
          }
        } });
        h.ports.clock = { now: () => new Date(instant) };
        const result = await refused(h.reader[lookup](lookup === 'lookupPostingEvidence' ? postingRequest() : reverseRequest()),
          fault === 'expired' || fault === 'stale' ? 'FORBIDDEN_SCOPE' : 'SOURCE_UNAVAILABLE');
        assert.equal(triggered, true, 'the real asynchronous boundary in the reader was reached');
        assert.equal(Object.hasOwn(result, 'value'), false);
        assert.equal(h.state.committed, boundary === 'commit');
        assert.equal(h.state.queries.at(-1).sql, boundary === 'commit' ? 'COMMIT' : 'ROLLBACK');
        assert.equal(h.state.calls.some(call => call.committed), false, 'no external authorization follows COMMIT');
        assert.deepEqual(h.state.releases, [false]);
      });
    }
  }
  for (const malformedPart of ['response', 'principal', 'scope']) {
    test(`${lookup} rejects malformed ${malformedPart} authority before pool acquisition`, async () => {
      for (const kind of ['user', 'service']) {
        const h = model({ authority(input) {
          const issued = decision(input, 'synthetic-revision', kind);
          const ownPrototype = value => Object.fromEntries([['__proto__', value]]);
          return malformedPart === 'response' ? ownPrototype(issued)
            : { ...issued, [malformedPart]: ownPrototype(issued[malformedPart]) };
        } });
        const result = await refused(h.reader[lookup](lookup === 'lookupPostingEvidence' ? postingRequest() : reverseRequest()));
        assert.equal(result.error.code, 'SOURCE_UNAVAILABLE');
        assert.equal(h.state.connections, 0);
        assert.deepEqual(h.state.queries, []);
      }
    });
  }
}
