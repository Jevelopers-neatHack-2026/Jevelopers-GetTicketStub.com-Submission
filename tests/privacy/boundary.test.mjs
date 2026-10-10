import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivacyBoundary } from '../../src/privacy/boundary.mjs';
import { createPrivacyFlows } from '../../src/privacy/flows.mjs';

function request(tenantId) {
  return Object.freeze({ principal: Object.freeze({ tenantId }) });
}

function fixtureBoundary(options = {}) {
  const time = { value: 1_000 };
  const boundary = createPrivacyBoundary({
    resolveTenant: (authenticatedRequest) => authenticatedRequest?.principal?.tenantId,
    now: () => time.value,
    retentionMs: 10_000,
    ...options,
  });
  return { boundary, time, scopeA: boundary.scopeForAuthenticatedRequest(request('tenant-a')), scopeB: boundary.scopeForAuthenticatedRequest(request('tenant-b')) };
}

function knownReview(source, facts) {
  return async (input) => {
    const exactSource = input.readSourceText();
    if (exactSource !== source) return { status: 'rejected', tenantId: input.tenantId, sourceDigest: input.sourceDigest };
    return { status: 'approved', tenantId: input.tenantId, sourceDigest: input.sourceDigest, facts };
  };
}

test('missing public-fact authority quarantines text rather than treating unmarked values as public', async () => {
  const { boundary, scopeA } = fixtureBoundary();
  const source = boundary.begin(scopeA, { modality: 'plain_text', content: 'Night Lights; admission code: 123' });
  const result = await boundary.prepare(scopeA, source.session, { event_name: '123' });
  assert.deepEqual(boundary.diagnostics(scopeA, result), {
    recordId: boundary.diagnostics(scopeA, result).recordId,
    state: 'quarantined',
    modality: 'plain_text',
    trust: 'untrusted_external',
    reasonCode: 'unverified_public_facts',
    redactionCategories: [],
  });
  assert.throws(() => boundary.publish(scopeA, source.session), /private evidence unavailable/);
});

test('only a positively reviewed fact set bound to the source digest can be published', async () => {
  const sourceText = 'Northstar Festival\nDate: 2027-06-20\nVenue: Civic Hall';
  const facts = Object.freeze({ event_name: 'Northstar Festival', event_date: '2027-06-20', venue: 'Civic Hall' });
  const { boundary, scopeA } = fixtureBoundary({ reviewPublicFacts: knownReview(sourceText, facts) });
  const source = boundary.begin(scopeA, { modality: 'plain_text', content: sourceText });
  const ready = await boundary.prepare(scopeA, source.session, { event_name: 'Northstar Festival' });
  assert.equal(boundary.diagnostics(scopeA, ready).state, 'ready_for_publish');
  const derivative = boundary.publish(scopeA, source.session);
  assert.deepEqual(boundary.exportDerivative(scopeA, derivative).facts, facts);
  assert.equal(boundary.retainedOriginalCount(), 0, 'publication releases the sole retained original');
  assert.equal(boundary.publish(scopeA, source.session), derivative, 'publish is idempotent after its synchronous commit');
});

test('the boundary snapshots byte input and candidate fields before async review', async () => {
  const bytes = Buffer.from('Exact public fixture');
  let release;
  let entered;
  const blocked = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  let observedCandidate;
  const { boundary, scopeA } = fixtureBoundary({ reviewPublicFacts: async (input) => {
    observedCandidate = input.candidate;
    entered();
    await blocked;
    assert.equal(input.readSourceText(), 'Exact public fixture');
    return { status: 'approved', tenantId: input.tenantId, sourceDigest: input.sourceDigest, facts: { event_name: 'Exact public fixture' } };
  } });
  const source = boundary.begin(scopeA, { modality: 'plain_text', content: bytes });
  bytes.fill(0);
  const candidate = { event_name: 'Exact public fixture' };
  const pending = boundary.prepare(scopeA, source.session, candidate);
  await started;
  candidate.event_name = 'MUTATED-CANDIDATE-CANARY';
  assert.equal(observedCandidate.event_name, 'Exact public fixture');
  assert.equal(Object.isFrozen(observedCandidate), true);
  release();
  const result = await pending;
  assert.equal(boundary.diagnostics(scopeA, result).state, 'ready_for_publish');
});

test('R2 copies bytes through typed-array intrinsics and sanitizes hostile source-object failures', async () => {
  const canary = 'SOURCE-ERROR-PRIVATE-CANARY';
  const sourceText = 'Safe intrinsic byte fixture';
  const { boundary, scopeA } = fixtureBoundary({ reviewPublicFacts: knownReview(sourceText, { event_name: 'Safe fixture' }) });
  const bytes = new Uint8Array(Buffer.from(sourceText));
  let conversionCalls = 0;
  Object.defineProperties(bytes, {
    valueOf: { value() { conversionCalls += 1; throw new Error(canary); } },
    constructor: { get() { conversionCalls += 1; throw new Error(canary); } },
    [Symbol.iterator]: { get() { conversionCalls += 1; throw new Error(canary); } },
  });
  const source = boundary.begin(scopeA, { modality: 'plain_text', content: bytes });
  assert.equal(conversionCalls, 0);
  const result = await boundary.prepare(scopeA, source.session, {});
  assert.equal(boundary.diagnostics(scopeA, result).state, 'ready_for_publish');
  assert.equal(boundary.exportDerivative(scopeA, boundary.publish(scopeA, source.session)).facts.event_name, 'Safe fixture');

  const revoked = Proxy.revocable(Uint8Array.of(65), {});
  revoked.revoke();
  let accessorCalled = false;
  const accessorDocument = {};
  Object.defineProperty(accessorDocument, 'content', {
    enumerable: true,
    get() {
      accessorCalled = true;
      throw new Error(canary);
    },
  });
  const throwingDocument = new Proxy({ modality: 'plain_text', content: 'ignored' }, {
    ownKeys() { throw new Error(canary); },
  });
  const revokedDocument = Proxy.revocable({ modality: 'plain_text', content: 'ignored' }, {});
  revokedDocument.revoke();
  const failures = [
    () => boundary.begin(scopeA, { modality: 'plain_text', content: revoked.proxy }),
    () => boundary.begin(scopeA, accessorDocument),
    () => boundary.begin(scopeA, throwingDocument),
    () => boundary.begin(scopeA, revokedDocument.proxy),
  ];
  const errors = [];
  for (const attempt of failures) {
    try {
      attempt();
      assert.fail('hostile source input unexpectedly succeeded');
    } catch (error) {
      errors.push(error);
      assert.equal(error.message, 'private evidence unavailable');
      assert.equal(error.cause, undefined);
    }
  }
  assert.equal(accessorCalled, false);
  for (const error of errors) assert.equal(error.stack.includes(canary), false);
  assert.equal(boundary.retainedOriginalCount(), 0);
});

test('reviewer rejection, exception, and mismatched tenant or digest fail closed', async (t) => {
  const cases = [
    ['rejection', async (input) => ({ status: 'rejected', tenantId: input.tenantId, sourceDigest: input.sourceDigest })],
    ['exception', async () => { throw new Error('private exception canary'); }],
    ['wrong tenant', async (input) => ({ status: 'approved', tenantId: 'tenant-b', sourceDigest: input.sourceDigest, facts: { event_name: 'Canary' } })],
    ['wrong digest', async (input) => ({ status: 'approved', tenantId: input.tenantId, sourceDigest: 'wrong-digest', facts: { event_name: 'Canary' } })],
  ];
  for (const [name, reviewer] of cases) {
    await t.test(name, async () => {
      const { boundary, scopeA } = fixtureBoundary({ reviewPublicFacts: reviewer });
      const source = boundary.begin(scopeA, { modality: 'plain_text', content: 'Possible event information' });
      const result = await boundary.prepare(scopeA, source.session, { event_name: 'Possible event information' });
      assert.equal(boundary.diagnostics(scopeA, result).state, 'quarantined');
      assert.throws(() => boundary.publish(scopeA, source.session), /private evidence unavailable/);
    });
  }
});

test('HTML, OCR, PDF text, and PDF metadata remain private without positive review; binary modalities never publish', async (t) => {
  for (const modality of ['html', 'ocr_text', 'pdf_text', 'pdf_metadata']) {
    await t.test(modality, async () => {
      const { boundary, scopeA } = fixtureBoundary();
      const source = boundary.begin(scopeA, { modality, content: '<p>PersonCanary ticket TKT-77</p>' });
      const result = await boundary.prepare(scopeA, source.session, { event_name: 'PersonCanary' });
      assert.equal(boundary.diagnostics(scopeA, result).reasonCode, 'unverified_public_facts');
      assert.throws(() => boundary.publish(scopeA, source.session), /private evidence unavailable/);
    });
  }
  for (const modality of ['image_binary', 'pdf_binary', 'attendee_csv', 'unknown_binary']) {
    await t.test(modality, async () => {
      const { boundary, scopeA } = fixtureBoundary({ reviewPublicFacts: async () => ({ status: 'approved' }) });
      const source = boundary.begin(scopeA, { modality, content: Uint8Array.of(0, 1, 2, 3) });
      const result = await boundary.prepare(scopeA, source.session, {});
      assert.equal(boundary.diagnostics(scopeA, result).reasonCode, 'unsupported_modality');
      assert.throws(() => boundary.publish(scopeA, source.session), /private evidence unavailable/);
    });
  }
});

test('malformed UTF-8, invalid candidates, and untrusted external references fail closed', async (t) => {
  const { boundary, scopeA } = fixtureBoundary({ reviewPublicFacts: async () => ({ status: 'approved' }) });
  const malformed = boundary.begin(scopeA, { modality: 'pdf_text', content: Uint8Array.of(0xc3, 0x28) });
  const malformedResult = await boundary.prepare(scopeA, malformed.session, {});
  assert.equal(boundary.diagnostics(scopeA, malformedResult).reasonCode, 'invalid_text');

  const source = boundary.begin(scopeA, { modality: 'plain_text', content: 'Private arbitrary text' });
  let getterCalled = false;
  const candidate = {};
  Object.defineProperty(candidate, 'event_name', { enumerable: true, get() { getterCalled = true; return 'Private arbitrary text'; } });
  const result = await boundary.prepare(scopeA, source.session, candidate);
  assert.equal(getterCalled, false);
  assert.equal(boundary.diagnostics(scopeA, result).reasonCode, 'invalid_candidate');

  assert.throws(() => boundary.begin(scopeA, { modality: 'plain_text', content: 'ok', external_reference: 'browser-tenant-b' }), /private evidence unavailable/);
  assert.throws(() => boundary.begin(scopeA, { modality: 'plain_text', content: '' }), /private evidence unavailable/);
});

test('tenant scopes are opaque capabilities and do not accept copied or serialized source handles', async () => {
  const { boundary, scopeA, scopeB } = fixtureBoundary();
  const source = boundary.begin(scopeA, { modality: 'plain_text', content: 'Tenant A source' });
  for (const forged of [{ ...source.source }, Object.create(source.source), JSON.parse(JSON.stringify(source.source))]) {
    assert.throws(() => boundary.restart(scopeA, forged), /private evidence unavailable/);
  }
  assert.throws(() => boundary.restart(scopeB, source.source), /private evidence unavailable/);
  assert.throws(() => boundary.cancel(scopeB, source.session), /private evidence unavailable/);
  assert.equal(boundary.sessionState(scopeA, source.session), 'accepting');
});

test('the missing authenticated-scope adapter fails closed', () => {
  const boundary = createPrivacyBoundary();
  assert.throws(() => boundary.scopeForAuthenticatedRequest({ tenantId: 'browser-controlled' }), /private evidence unavailable/);
});

test('cancel during async review wins, aborts the read capability, and leaves no derivative or retained original', async () => {
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  let readDenied = false;
  const reviewer = async (input) => {
    entered();
    await blocked;
    try {
      input.readSourceText();
    } catch {
      readDenied = true;
    }
    return { status: 'approved', tenantId: input.tenantId, sourceDigest: input.sourceDigest, facts: { event_name: 'Late private canary' } };
  };
  const { boundary, scopeA } = fixtureBoundary({ reviewPublicFacts: reviewer });
  const source = boundary.begin(scopeA, { modality: 'plain_text', content: 'Late private canary' });
  const pending = boundary.prepare(scopeA, source.session, { event_name: 'Late private canary' });
  await started;
  assert.equal(boundary.cancel(scopeA, source.session), true);
  assert.equal(boundary.retainedOriginalCount(), 0);
  release();
  const result = await pending;
  assert.equal(readDenied, true);
  assert.equal(boundary.diagnostics(scopeA, result).state, 'cancelled');
  assert.throws(() => boundary.publish(scopeA, source.session), /private evidence unavailable/);
  assert.equal(boundary.cancel(scopeA, source.session), false);
});

test('candidate Proxy cancellation remains terminal and prevents reviewer invocation', async (t) => {
  for (const withReviewer of [false, true]) {
    await t.test(withReviewer ? 'configured reviewer' : 'no reviewer configured', async () => {
      let reviewerCalls = 0;
      const options = withReviewer ? {
        reviewPublicFacts: async (input) => {
          reviewerCalls += 1;
          return { status: 'approved', tenantId: input.tenantId, sourceDigest: input.sourceDigest, facts: { event_name: 'Fixture' } };
        },
      } : {};
      const { boundary, scopeA } = fixtureBoundary(options);
      const flows = createPrivacyFlows(boundary);
      const source = boundary.begin(scopeA, { modality: 'plain_text', content: 'Private fixture' });
      const cancelResults = [];
      const candidate = new Proxy({ event_name: 'Private fixture' }, {
        ownKeys(target) {
          cancelResults.push(boundary.cancel(scopeA, source.session));
          return Reflect.ownKeys(target);
        },
      });

      const result = await boundary.prepare(scopeA, source.session, candidate);
      const diagnostic = boundary.diagnostics(scopeA, result);
      assert.deepEqual(cancelResults, [true]);
      assert.equal(reviewerCalls, 0);
      assert.equal(diagnostic.state, 'cancelled');
      assert.equal(diagnostic.reasonCode, 'cancelled');
      assert.equal(boundary.sessionState(scopeA, source.session), 'cancelled');
      assert.equal(boundary.retainedOriginalCount(), 0);
      assert.throws(() => boundary.publish(scopeA, source.session), /private evidence unavailable/);

      const telemetry = flows.diagnostic.record(scopeA, result);
      const serialized = JSON.parse(flows.serialize(scopeA, { telemetryValues: [telemetry] }));
      assert.equal(serialized.telemetry[0].state, 'cancelled');
      assert.equal(serialized.telemetry[0].reasonCode, 'cancelled');
    });
  }
});

test('review decision and facts Proxy cancellation cannot overwrite terminal state or telemetry', async (t) => {
  for (const trapTarget of ['decision', 'facts']) {
    await t.test(`cancelling from ${trapTarget} validation`, async () => {
      let fixture;
      let reviewCalls = 0;
      const cancellationResults = [];
      fixture = fixtureBoundary({
        reviewPublicFacts: async (input) => {
          reviewCalls += 1;
          const facts = new Proxy({ event_name: 'Fixture' }, {
            ownKeys(target) {
              if (trapTarget === 'facts') cancellationResults.push(fixture.boundary.cancel(fixture.scopeA, fixture.source.session));
              return Reflect.ownKeys(target);
            },
          });
          const decision = { status: 'approved', tenantId: input.tenantId, sourceDigest: input.sourceDigest, facts };
          if (trapTarget === 'decision') {
            return new Proxy(decision, {
              ownKeys(target) {
                cancellationResults.push(fixture.boundary.cancel(fixture.scopeA, fixture.source.session));
                return Reflect.ownKeys(target);
              },
            });
          }
          return decision;
        },
      });
      const flows = createPrivacyFlows(fixture.boundary);
      fixture.source = fixture.boundary.begin(fixture.scopeA, { modality: 'plain_text', content: 'Fixture' });
      const result = await fixture.boundary.prepare(fixture.scopeA, fixture.source.session, {});
      const diagnostic = fixture.boundary.diagnostics(fixture.scopeA, result);

      assert.equal(reviewCalls, 1);
      assert.deepEqual(cancellationResults, [true]);
      assert.equal(diagnostic.state, 'cancelled');
      assert.equal(diagnostic.reasonCode, 'cancelled');
      assert.equal(fixture.boundary.sessionState(fixture.scopeA, fixture.source.session), 'cancelled');
      assert.equal(fixture.boundary.retainedOriginalCount(), 0);
      assert.throws(() => fixture.boundary.publish(fixture.scopeA, fixture.source.session), /private evidence unavailable/);

      const telemetry = flows.diagnostic.record(fixture.scopeA, result);
      const serialized = JSON.parse(flows.serialize(fixture.scopeA, { telemetryValues: [telemetry] }));
      assert.equal(serialized.telemetry[0].state, 'cancelled');
      assert.equal(serialized.telemetry[0].reasonCode, 'cancelled');
    });
  }
});

test('concurrent prepare is single-flight and cancellation cannot be overwritten by a late result', async () => {
  let release;
  let entered;
  const blocked = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const { boundary, scopeA } = fixtureBoundary({ reviewPublicFacts: async (input) => {
    entered();
    await blocked;
    return { status: 'approved', tenantId: input.tenantId, sourceDigest: input.sourceDigest, facts: { event_name: 'Event Canary' } };
  } });
  const source = boundary.begin(scopeA, { modality: 'plain_text', content: 'Event Canary' });
  const first = boundary.prepare(scopeA, source.session, { event_name: 'Event Canary' });
  await started;
  await assert.rejects(boundary.prepare(scopeA, source.session, { event_name: 'Different candidate' }), /private evidence unavailable/);
  boundary.cancel(scopeA, source.session);
  release();
  await first;
  assert.equal(boundary.sessionState(scopeA, source.session), 'cancelled');
  assert.equal(boundary.retainedOriginalCount(), 0);
});

test('publish and cancel have a synchronous linearization point in either scheduling order', async (t) => {
  for (const firstOperation of ['cancel', 'publish']) {
    await t.test(`${firstOperation} commits first`, async () => {
      const text = 'Public fixture event';
      const { boundary, scopeA } = fixtureBoundary({ reviewPublicFacts: knownReview(text, { event_name: 'Fixture Event' }) });
      const source = boundary.begin(scopeA, { modality: 'plain_text', content: text });
      await boundary.prepare(scopeA, source.session, {});
      const order = firstOperation === 'cancel' ? ['cancel', 'publish'] : ['publish', 'cancel'];
      const operations = order.map((operation) => Promise.resolve().then(() => operation === 'cancel'
        ? boundary.cancel(scopeA, source.session)
        : boundary.publish(scopeA, source.session)));
      const outcomes = await Promise.allSettled(operations);
      if (firstOperation === 'cancel') {
        assert.equal(outcomes[0].status, 'fulfilled');
        assert.equal(outcomes[0].value, true);
        assert.equal(outcomes[1].status, 'rejected');
        assert.equal(boundary.sessionState(scopeA, source.session), 'cancelled');
      } else {
        assert.equal(outcomes[0].status, 'fulfilled');
        assert.equal(outcomes[1].status, 'fulfilled');
        assert.equal(outcomes[1].value, false);
        assert.equal(boundary.sessionState(scopeA, source.session), 'published');
      }
    });
  }
});

test('expiry is authoritative across restart, prepare, purge, and the post-review commit check', async (t) => {
  await t.test('restart just before expiry does not extend original retention', async () => {
    const text = 'Fixture event';
    const { boundary, scopeA, time } = fixtureBoundary({ reviewPublicFacts: knownReview(text, { event_name: 'Fixture Event' }) });
    const source = boundary.begin(scopeA, { modality: 'plain_text', content: text });
    time.value += 9_999;
    const restarted = boundary.restart(scopeA, source.source);
    time.value += 1;
    assert.equal(boundary.purgeExpired(), 1);
    assert.equal(boundary.retainedOriginalCount(), 0);
    const first = await boundary.prepare(scopeA, source.session, {});
    const second = await boundary.prepare(scopeA, restarted, {});
    assert.equal(boundary.diagnostics(scopeA, first).state, 'expired');
    assert.equal(boundary.diagnostics(scopeA, second).state, 'expired');
    assert.throws(() => boundary.restart(scopeA, source.source), /private evidence unavailable/);
  });

  await t.test('expiry while reviewer is awaiting prevents commit and clears the original', async () => {
    let release;
    let entered;
    const blocked = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { entered = resolve; });
    const text = 'Delayed fixture event';
    const { boundary, scopeA, time } = fixtureBoundary({ reviewPublicFacts: async (input) => {
      entered();
      await blocked;
      return { status: 'approved', tenantId: input.tenantId, sourceDigest: input.sourceDigest, facts: { event_name: 'Delayed Fixture' } };
    } });
    const source = boundary.begin(scopeA, { modality: 'plain_text', content: text });
    const pending = boundary.prepare(scopeA, source.session, {});
    await started;
    time.value += 10_000;
    assert.equal(boundary.purgeExpired(), 1);
    release();
    const result = await pending;
    assert.equal(boundary.diagnostics(scopeA, result).state, 'expired');
    assert.equal(boundary.retainedOriginalCount(), 0);
    assert.throws(() => boundary.publish(scopeA, source.session), /private evidence unavailable/);
  });

  await t.test('expiry after preparation but before publication prevents derivative creation', async () => {
    const text = 'Near-expiry fixture';
    const { boundary, scopeA, time } = fixtureBoundary({ reviewPublicFacts: knownReview(text, { event_name: 'Near-expiry fixture' }) });
    const source = boundary.begin(scopeA, { modality: 'plain_text', content: text });
    await boundary.prepare(scopeA, source.session, {});
    time.value += 10_000;
    assert.equal(boundary.sessionState(scopeA, source.session), 'expired');
    assert.equal(boundary.diagnostics(scopeA, boundary.result(scopeA, source.session)).state, 'expired');
    assert.throws(() => boundary.publish(scopeA, source.session), /private evidence unavailable/);
    assert.equal(boundary.retainedOriginalCount(), 0);
  });
});

test('private originals require same-tenant explicit review and are unavailable after TTL', async () => {
  const observed = [];
  const { boundary, scopeA, scopeB, time } = fixtureBoundary({
    authorizePrivateReview: async ({ tenantId, request: reviewRequest }) => tenantId === 'tenant-a' && reviewRequest?.approved === true,
    consumePrivateOriginal: async (input) => { observed.push(input.content); return 'reviewed'; },
  });
  const source = boundary.begin(scopeA, { modality: 'plain_text', content: 'PRIVATE-ORIGINAL-CANARY' });
  await assert.rejects(boundary.withPrivateOriginal(scopeA, source.source, { approved: false }), /private evidence unavailable/);
  await assert.rejects(boundary.withPrivateOriginal(scopeB, source.source, { approved: true }), /private evidence unavailable/);
  assert.equal(await boundary.withPrivateOriginal(scopeA, source.source, { approved: true }), 'reviewed');
  assert.deepEqual(observed, ['PRIVATE-ORIGINAL-CANARY']);
  time.value += 10_000;
  await assert.rejects(boundary.withPrivateOriginal(scopeA, source.source, { approved: true }), /private evidence unavailable/);
  assert.equal(boundary.retainedOriginalCount(), 0);
});
