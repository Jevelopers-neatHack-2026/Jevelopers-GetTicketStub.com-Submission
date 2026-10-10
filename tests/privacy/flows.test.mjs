import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivacyBoundary } from '../../src/privacy/boundary.mjs';
import { createPrivacyFlows } from '../../src/privacy/flows.mjs';

function request(tenantId) {
  return Object.freeze({ principal: Object.freeze({ tenantId }) });
}

function setup(options = {}) {
  const boundary = createPrivacyBoundary({
    resolveTenant: (authenticatedRequest) => authenticatedRequest?.principal?.tenantId,
    ...options,
  });
  return {
    boundary,
    flows: createPrivacyFlows(boundary),
    scopeA: boundary.scopeForAuthenticatedRequest(request('tenant-a')),
    scopeB: boundary.scopeForAuthenticatedRequest(request('tenant-b')),
  };
}

function exactFixtureReview(source, facts) {
  return async (input) => {
    if (input.readSourceText() !== source) return { status: 'rejected', tenantId: input.tenantId, sourceDigest: input.sourceDigest };
    return { status: 'approved', tenantId: input.tenantId, sourceDigest: input.sourceDigest, facts };
  };
}

function outputStrings(value, field = '') {
  if (field === 'recordId') return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => outputStrings(item));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => outputStrings(item, key));
  }
  return [];
}

test('R1 stripped-label PII, short codes, private addresses, and uncertain text cannot reach any output flow', async () => {
  const cases = [
    {
      source: 'attendee name: PersonCanary; ticket code: TKT-CANARY-42',
      candidate: { event_name: 'PersonCanary', venue: 'TKT-CANARY-42' },
      canaries: ['PersonCanary', 'TKT-CANARY-42'],
    },
    {
      source: 'Night Lights; admission code: 123',
      candidate: { event_name: '123' },
      canaries: ['123'],
    },
    {
      source: 'Private home: 123 Canary Lane',
      candidate: { venue: '123 Canary Lane' },
      canaries: ['123 Canary Lane'],
    },
    {
      source: 'Contact: +33 6 12 34 56 78; mail: ava [at] private.example; QR: X-7',
      candidate: { event_name: '+33 6 12 34 56 78', venue: 'ava [at] private.example', event_date: 'X-7' },
      canaries: ['+33 6 12 34 56 78', 'ava [at] private.example', 'X-7'],
    },
    {
      source: 'Bring your own chairs. Call me when you arrive.',
      candidate: { event_name: 'Call me when you arrive' },
      canaries: ['Call me when you arrive'],
    },
  ];

  for (const { source: safeFixtureSource, candidate, canaries } of cases) {
    const { boundary, flows, scopeA } = setup({
      reviewPublicFacts: exactFixtureReview('A different, positively reviewed public fixture', { event_name: 'Reviewed Public Fixture' }),
    });
    const source = boundary.begin(scopeA, { modality: 'plain_text', content: safeFixtureSource });
    const result = await boundary.prepare(scopeA, source.session, candidate);
    const diagnostics = boundary.diagnostics(scopeA, result);
    assert.equal(diagnostics.state, 'quarantined');
    assert.equal(diagnostics.reasonCode, 'invalid_review_decision');
    const telemetry = flows.diagnostic.record(scopeA, result);
    assert.equal(flows.cache.snapshot(scopeA).length, 0);
    assert.throws(() => boundary.publish(scopeA, source.session), /private evidence unavailable/);
    assert.throws(() => flows.makeDecisionState(scopeA, {}), /private evidence unavailable/);
    assert.throws(() => flows.makeCreativePayload(scopeA, {}), /private evidence unavailable/);

    const serialized = flows.serialize(scopeA, {
      cacheValues: flows.cache.snapshot(scopeA),
      telemetryValues: [telemetry],
      decisionValues: [],
      creativeValues: [],
    });
    const serializedOutput = JSON.parse(serialized);
    const publicStrings = outputStrings(serializedOutput);
    for (const canary of canaries) assert.equal(publicStrings.some((value) => value.includes(canary)), false, `leaked ${canary}`);
    assert.equal(publicStrings.some((value) => value.includes(safeFixtureSource)), false);
  }
});

test('verified public fixture facts traverse the real cache, telemetry, decision, creative, and serialization helpers', async () => {
  const sourceText = 'Northstar Festival\nDate: 2027-06-20\nVenue: Civic Hall';
  const approvedFacts = Object.freeze({ event_name: 'Northstar Festival', event_date: '2027-06-20', venue: 'Civic Hall' });
  const { boundary, flows, scopeA } = setup({ reviewPublicFacts: exactFixtureReview(sourceText, approvedFacts) });
  const source = boundary.begin(scopeA, { modality: 'plain_text', content: sourceText });
  const result = await boundary.prepare(scopeA, source.session, { event_name: 'Northstar Festival' });
  const derivative = boundary.publish(scopeA, source.session);
  flows.cache.put(scopeA, 'fixture-event', derivative);
  const telemetry = flows.diagnostic.record(scopeA, boundary.result(scopeA, source.session));
  const decision = flows.makeDecisionState(scopeA, derivative);
  const creative = flows.makeCreativePayload(scopeA, derivative);

  assert.equal(flows.cache.get(scopeA, 'fixture-event'), derivative);
  assert.deepEqual(flows.diagnostic.snapshot(scopeA), [telemetry]);
  assert.equal(flows.decisionPayload(scopeA, decision).facts.event_name, 'Northstar Festival');
  assert.equal(flows.creativePayload(scopeA, creative).eventFacts.venue, 'Civic Hall');
  const serialized = flows.serialize(scopeA, {
    cacheValues: flows.cache.snapshot(scopeA),
    telemetryValues: flows.diagnostic.snapshot(scopeA),
    decisionValues: [decision],
    creativeValues: [creative],
  });
  assert.match(serialized, /Northstar Festival/);
  assert.match(serialized, /Civic Hall/);
  assert.equal(serialized.includes(sourceText), false, 'the raw document is never a downstream payload');
  assert.equal(boundary.diagnostics(scopeA, result).state, 'ready_for_publish');
});

test('serializer rejects caller array hooks and verifies the scope even for empty selections', () => {
  const { flows, scopeA } = setup();
  const canary = 'UNREVIEWED-SERIALIZATION-CANARY';
  const selectionFields = ['cacheValues', 'telemetryValues', 'decisionValues', 'creativeValues'];

  for (const field of selectionFields) {
    const values = [];
    values.map = () => [{ facts: { event_name: canary } }];
    let error;
    try {
      flows.serialize(scopeA, { [field]: values });
    } catch (caught) {
      error = caught;
    }
    assert.equal(error?.message, 'private evidence unavailable');
    assert.equal(`${error?.stack ?? ''}${error?.cause ?? ''}`.includes(canary), false);
  }

  let speciesCalls = 0;
  let toJSONCalls = 0;
  class AttackerArray extends Array {
    static get [Symbol.species]() {
      speciesCalls += 1;
      throw new Error(canary);
    }

    toJSON() {
      toJSONCalls += 1;
      return [{ facts: { event_name: canary } }];
    }
  }
  const subclass = new AttackerArray();
  assert.throws(() => flows.serialize(scopeA, { cacheValues: subclass }), (error) => {
    assert.equal(error.message, 'private evidence unavailable');
    assert.equal(error.stack.includes(canary), false);
    return true;
  });
  assert.equal(speciesCalls, 0);
  assert.equal(toJSONCalls, 0);

  assert.throws(() => flows.serialize({}, {}), /private evidence unavailable/);
});

test('serializer rejects forged handles, accessors, proxies, and throwing collection traps without partial output', async () => {
  const { boundary, flows, scopeA, scopeB } = setup({
    reviewPublicFacts: exactFixtureReview('public fixture', { event_name: 'Public fixture' }),
  });
  const start = boundary.begin(scopeA, { modality: 'plain_text', content: 'public fixture' });
  const result = await boundary.prepare(scopeA, start.session, {});
  const issued = boundary.publish(scopeA, start.session);
  const forged = { ...issued };
  const canary = 'SELECTION-ERROR-PRIVATE-CANARY';
  flows.cache.put(scopeA, 'public-fixture', issued);
  const telemetry = flows.diagnostic.record(scopeA, result);
  const decision = flows.makeDecisionState(scopeA, issued);
  const creative = flows.makeCreativePayload(scopeA, issued);
  const baselineCache = flows.cache.snapshot(scopeA);
  const baselineTelemetry = flows.diagnostic.snapshot(scopeA);
  const errors = [];

  const accessorArray = [issued];
  let accessorCalled = false;
  Object.defineProperty(accessorArray, '0', {
    configurable: true,
    get() {
      accessorCalled = true;
      throw new Error(canary);
    },
  });
  const throwingArray = new Proxy([], {
    getPrototypeOf() { throw new Error(canary); },
  });
  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  const throwingSelections = new Proxy({}, {
    ownKeys() { throw new Error(canary); },
  });
  const descriptorSelections = new Proxy({ cacheValues: [] }, {
    getOwnPropertyDescriptor() { throw new Error(canary); },
  });
  let selectionGetterCalled = false;
  const accessorSelections = {};
  Object.defineProperty(accessorSelections, 'cacheValues', {
    enumerable: true,
    get() {
      selectionGetterCalled = true;
      throw new Error(canary);
    },
  });

  for (const [label, scope, selection] of [
    ['accessor', scopeA, { cacheValues: accessorArray }],
    ['selection accessor', scopeA, accessorSelections],
    ['array proxy', scopeA, { cacheValues: throwingArray }],
    ['revoked array', scopeA, { cacheValues: revoked.proxy }],
    ['ownKeys proxy', scopeA, throwingSelections],
    ['descriptor proxy', scopeA, descriptorSelections],
    ['forged handle after valid selection', scopeA, { cacheValues: [issued, forged] }],
    ['cross tenant', scopeB, { cacheValues: [issued] }],
  ]) {
    try {
      flows.serialize(scope, selection);
      assert.fail(`${label} selection unexpectedly serialized`);
    } catch (error) {
      errors.push(error);
      assert.equal(error.message, 'private evidence unavailable');
    }
  }

  assert.equal(accessorCalled, false);
  assert.equal(selectionGetterCalled, false);
  for (const error of errors) {
    assert.equal(error.stack.includes(canary), false);
    assert.equal(error.cause, undefined);
  }
  assert.deepEqual(flows.cache.snapshot(scopeA), baselineCache);
  assert.deepEqual(flows.diagnostic.snapshot(scopeA), baselineTelemetry);
  assert.doesNotMatch(errors.map((error) => `${error.message}\n${error.stack}`).join('\n'), new RegExp(canary));
  const laterValidOutput = flows.serialize(scopeA, {
    cacheValues: [issued],
    telemetryValues: [telemetry],
    decisionValues: [decision],
    creativeValues: [creative],
  });
  assert.match(laterValidOutput, /Public fixture/);
});

test('R2 copied, cloned, or relabeled handles cannot spoof derivative contents, tenants, telemetry, or flow payloads', async () => {
  const sourceText = 'Verified Fixture';
  const { boundary, flows, scopeA, scopeB } = setup({
    reviewPublicFacts: exactFixtureReview(sourceText, { event_name: 'Verified Fixture' }),
  });
  const started = boundary.begin(scopeA, { modality: 'plain_text', content: sourceText });
  const result = await boundary.prepare(scopeA, started.session, {});
  const derivative = boundary.publish(scopeA, started.session);
  const genuineResult = boundary.result(scopeA, started.session);
  const telemetry = flows.diagnostic.record(scopeA, genuineResult);
  const decision = flows.makeDecisionState(scopeA, derivative);
  const creative = flows.makeCreativePayload(scopeA, derivative);

  const copiedSource = Object.assign(Object.create(null), { tenantId: 'tenant-b', token: 'copied-source' });
  const copiedDerivative = Object.assign(Object.create(null), { tenantId: 'tenant-b', facts: { event_name: 'COPIED-SEAL-PRIVATE-CANARY' } });
  const copiedResult = Object.assign(Object.create(null), { tenantId: 'tenant-b', recordId: 'TELEMETRY-CANARY', modality: 'FORGED-MODALITY' });
  const copiedTelemetry = Object.assign(Object.create(null), { tenantId: 'tenant-b', recordId: 'TELEMETRY-CANARY' });
  const copiedDecision = Object.assign(Object.create(null), { tenantId: 'tenant-b', facts: { event_name: 'DECISION-CANARY' } });
  const copiedCreative = Object.assign(Object.create(null), { tenantId: 'tenant-b', eventFacts: { event_name: 'CREATIVE-CANARY' } });

  assert.throws(() => boundary.restart(scopeB, copiedSource), /private evidence unavailable/);
  assert.throws(() => boundary.exportDerivative(scopeA, copiedDerivative), /private evidence unavailable/);
  assert.throws(() => flows.cache.put(scopeB, 'forged', derivative), /private evidence unavailable/);
  assert.throws(() => flows.cache.put(scopeA, 'copied', copiedDerivative), /private evidence unavailable/);
  assert.throws(() => boundary.diagnostics(scopeB, genuineResult), /private evidence unavailable/);
  assert.throws(() => boundary.diagnostics(scopeB, copiedResult), /private evidence unavailable/);
  assert.throws(() => flows.diagnostic.record(scopeB, genuineResult), /private evidence unavailable/);
  assert.throws(() => flows.serialize(scopeA, { telemetryValues: [copiedTelemetry] }), /private evidence unavailable/);
  assert.throws(() => flows.decisionPayload(scopeA, copiedDecision), /private evidence unavailable/);
  assert.throws(() => flows.creativePayload(scopeA, copiedCreative), /private evidence unavailable/);
  assert.throws(() => flows.serialize(scopeB, { decisionValues: [decision] }), /private evidence unavailable/);
  assert.throws(() => flows.serialize(scopeB, { creativeValues: [creative] }), /private evidence unavailable/);
  assert.throws(() => flows.serialize(scopeB, { telemetryValues: [telemetry] }), /private evidence unavailable/);

  for (const altered of [Object.create(derivative), { ...derivative }, JSON.parse(JSON.stringify(derivative))]) {
    assert.throws(() => boundary.exportDerivative(scopeA, altered), /private evidence unavailable/);
  }
  for (const altered of [Object.create(genuineResult), { ...genuineResult }]) {
    assert.throws(() => boundary.diagnostics(scopeA, altered), /private evidence unavailable/);
    assert.throws(() => flows.diagnostic.record(scopeA, altered), /private evidence unavailable/);
  }
  for (const altered of [Object.create(telemetry), { ...telemetry }]) {
    assert.throws(() => flows.serialize(scopeA, { telemetryValues: [altered] }), /private evidence unavailable/);
  }
  for (const altered of [Object.create(decision), { ...decision }]) {
    assert.throws(() => flows.decisionPayload(scopeA, altered), /private evidence unavailable/);
  }
  for (const altered of [Object.create(creative), { ...creative }]) {
    assert.throws(() => flows.creativePayload(scopeA, altered), /private evidence unavailable/);
  }
});

test('cache, telemetry, decisions, and creative payloads remain tenant-partitioned across scopes', async () => {
  const sourceText = 'Shared tenant fixture';
  const { boundary, flows, scopeA, scopeB } = setup({
    reviewPublicFacts: exactFixtureReview(sourceText, { event_name: 'Shared tenant fixture' }),
  });
  const started = boundary.begin(scopeA, { modality: 'plain_text', content: sourceText });
  const result = await boundary.prepare(scopeA, started.session, {});
  const derivative = boundary.publish(scopeA, started.session);
  flows.cache.put(scopeA, 'event', derivative);
  const telemetry = flows.diagnostic.record(scopeA, result);
  const decision = flows.makeDecisionState(scopeA, derivative);
  const creative = flows.makeCreativePayload(scopeA, derivative);

  const anotherScopeForA = boundary.scopeForAuthenticatedRequest(request('tenant-a'));
  assert.equal(flows.cache.get(anotherScopeForA, 'event'), derivative);
  assert.equal(flows.cache.snapshot(scopeB).length, 0);
  assert.equal(flows.diagnostic.snapshot(scopeB).length, 0);
  assert.throws(() => flows.serialize(scopeB, { cacheValues: [derivative] }), /private evidence unavailable/);
  assert.throws(() => flows.serialize(scopeB, { decisionValues: [decision] }), /private evidence unavailable/);
  assert.throws(() => flows.serialize(scopeB, { creativeValues: [creative] }), /private evidence unavailable/);
  assert.throws(() => flows.serialize(scopeB, { telemetryValues: [telemetry] }), /private evidence unavailable/);
});

test('flow adapters reject a copied or caller-shaped boundary object', () => {
  const { boundary } = setup();
  assert.throws(() => createPrivacyFlows({ ...boundary }), /privacy boundary instance required/);
  assert.throws(() => createPrivacyFlows(Object.create(boundary)), /privacy boundary instance required/);
});
