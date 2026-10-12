import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../proposals/reporting-v1/validate.mjs';

// Synthetic validator doubles isolate the runner's error-location assertion.
// These are NOT Ajv/schema/consumer-conformance results; the separate integration
// suite exercises the real strict Ajv validator and the CLI.
function inspect(expected, errors, keyword = 'type') {
  const fx = {
    synthetic: true,
    cases: [
      { id: 'positive', schema: 'query', expect: 'valid', data: { valid: true } },
      {
        id: 'negative', schema: 'query', expect: 'invalid', base: 'positive',
        patch: [{ op: 'replace', path: '/valid', value: false }],
        error_at: expected, keyword,
      },
    ],
  };
  const validate = (data) => {
    validate.errors = data.valid ? null : errors;
    return data.valid;
  };
  return evaluate(fx, { query: validate });
}
const error = (instancePath, keyword = 'type') => ({ instancePath, keyword });

for (const [expected, actual] of [
  ['/currency', '/currency_extra'],
  ['/currenc', '/currency'],
  ['/rows/1', '/rows/10/value'],
  ['/rows/1/value', '/rows/1/value_extra'],
  ['/a~1b', '/a~1bc'],
  ['/a~0b', '/a~0bc'],
  ['/', '/currency'],
  ['/rows/', '/rows/0'],
]) {
  test(`prefix collision rejects ${JSON.stringify(expected)} versus ${JSON.stringify(actual)}`, () => {
    const result = inspect(expected, [error(actual)]);
    assert.equal(result.counts.passed, 1, 'only the positive control passes');
    assert.equal(result.counts.failed, 1);
    assert.deepEqual(result.failures.map(({ ordinal, reason }) => ({ ordinal, reason })),
      [{ ordinal: 2, reason: 'error_location_mismatch' }]);
  });
}

for (const [expected, actual] of [
  ['/currency', '/currency'],
  ['/rows/1', '/rows/1/value'],
  ['/a~1b', '/a~1b/child'],
  ['/a~0b', '/a~0b/child'],
  ['', ''],
  ['', '/currency'],
  ['/', '/'],
  ['/', '//child'],
  ['/rows/', '/rows//value'],
]) {
  test(`exact or descendant location passes ${JSON.stringify(expected)} versus ${JSON.stringify(actual)}`, () => {
    const result = inspect(expected, [error(actual)]);
    assert.equal(result.counts.passed, 2);
    assert.equal(result.counts.failed, 0);
    assert.deepEqual(result.failures, []);
  });
}

test('location and keyword must match the same error', () => {
  const result = inspect('/rows/1', [error('/rows/1/value', 'minimum'), error('/rows/10/value')]);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.failures[0].reason, 'error_location_mismatch');
});

test('a later exact error can satisfy the assertion; summary truncation does not change matching', () => {
  const errors = Array.from({ length: 6 }, () => error('/rows/10/value'));
  errors.push(error('/rows/1/value'));
  assert.equal(inspect('/rows/1', errors).counts.failed, 0);
});

test('an absent error cannot satisfy a negative even when its expectation is root', () => {
  const result = inspect('', []);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.failures[0].reason, 'error_location_mismatch');
});
