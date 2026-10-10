import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvenancePort, isProvenancePort } from '../../src/verification/provenance/index.mjs';

test('internal provenance port delegates fact persistence without adding another schema', async () => {
  const calls = [];
  const store = {
    appendFact: async (...args) => { calls.push(['appendFact', ...args]); return 'fact-handle'; },
    lookupFact: async (...args) => { calls.push(['lookupFact', ...args]); return 'looked-up-handle'; },
    readFact: async (...args) => { calls.push(['readFact', ...args]); return { status: 'missing' }; },
    listFacts: async (...args) => { calls.push(['listFacts', ...args]); return [{ status: 'missing' }]; },
  };
  const port = createProvenancePort(store);
  assert.equal(isProvenancePort(port), true);
  assert.equal(isProvenancePort(store), false);
  assert.equal(Object.isFrozen(port), true);

  const scope = Object.freeze(Object.create(null));
  const request = Object.freeze({ principal: 'synthetic' });
  const fact = Object.freeze({ field: 'event_name', status: 'missing' });
  const handle = Object.freeze(Object.create(null));
  assert.equal(await port.record(scope, fact, request), 'fact-handle');
  assert.equal(await port.lookup(scope, 'opaque-id'), 'looked-up-handle');
  assert.deepEqual(await port.read(scope, handle, request), { status: 'missing' });
  assert.deepEqual(await port.list(scope, request), [{ status: 'missing' }]);
  assert.deepEqual(calls.map(([method]) => method), ['appendFact', 'lookupFact', 'readFact', 'listFacts']);
  assert.equal(calls[0][1], scope);
  assert.equal(calls[0][2], fact);
  assert.equal(calls[0][3], request);
});

test('provenance port requires the durable fact store surface', () => {
  assert.throws(() => createProvenancePort({ appendFact() {} }), TypeError);
});
