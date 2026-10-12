import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hashManifest } from '../generated/index.mjs';
import { checkRowResult, checkBatchResult, checkBatchPages, projectBatchPartialFailure, projectBatchJobStatus, checkCsvInput, checkPersonalizationPlan } from '../tooling/production-operations.mjs';

const read = async name => JSON.parse(await readFile(new URL('../fixtures/' + name + '.json', import.meta.url), 'utf8'));
const calibration = await read('ProductionCalibration');
const dialect = (await read('CsvDialect')).valid, mapping = (await read('CsvMapping')).valid, checkpoint = (await read('CsvCheckpoint')).valid;
const request = (await read('PersonalizeBatchRequest')).valid;
const frozen = await read('ProductionRowCsvContextCalibration');
const copy = structuredClone;
const ref = value => ({ contract: value.contract, schema_version: value.schema_version, id: value.id, revision: value.revision, content_hash: value.content_hash });
const context = { scope: copy(calibration.scope), job: copy(calibration.batch.job), original_rows: copy(calibration.rows) };
const bases = {
  row: { value: calibration.batch.rows[0], context },
  batch: { value: calibration.batch, context },
  csv: { value: { ...request, input: { kind: 'csv', file_ref: checkpoint.file_ref, dialect_ref: ref(dialect), mapping_ref: ref(mapping) } }, context: { enabled: true, scope: calibration.scope, enabling_ref: ref(dialect), expected_enabling_ref: ref(dialect), dialect, mapping, row_policy: calibration.personalization } }
};
const routes = {
  row: input => checkRowResult(input.value, input.context),
  batch: input => checkBatchResult(input.value, input.context),
  pages: input => checkBatchPages([input.value], input.context),
  partialProjection: input => projectBatchPartialFailure([input.value], input.context),
  jobProjection: input => projectBatchJobStatus([input.value], input.context),
  csv: input => checkCsvInput(input.value, input.context)
};
const mutations = {
  cycle: value => { value.extra = value; },
  hidden: value => { Object.defineProperty(value, 'extra', { value: 1, enumerable: false }); },
  symbol: value => { value[Symbol('extra')] = 1; },
  deep: value => { let extra = {}; for (let index = 0; index < 65; index++) extra = { extra }; value.extra = extra; }
};
const baseFor = route => copy(bases[route === 'row' ? 'row' : route === 'csv' ? 'csv' : 'batch']);
const rejectsContext = result => { assert.equal(result.ok, false); assert.equal(result.errors[0].code, 'INVALID_TRUST_CONTEXT'); };

test('row and CSV context regression bases retain the independent review hashes', () => {
  assert.equal(hashManifest(bases.row), 'sha256:2eff594b7dded7f45350f08c324df1bfa79b23f1cc8bb8c799e8e9b3e3e76a2a');
  assert.equal(hashManifest(bases.batch), 'sha256:58ffb4a91e32daf79a1b6135c230d9bce0ebad5a1867b1d6b2d46933525521b7');
  assert.equal(hashManifest(bases.csv), 'sha256:1325eb87418f608ce313bec3ecce48eaf893d757d7dcbef74f51d3767829585f');
});
for (const route of ['row', 'batch', 'pages']) {
  test('supported row context / ' + route, () => assert.equal(routes[route](baseFor(route)).ok, true));
  test('canonical job mismatch stays NOT_FOUND / ' + route, () => {
    const input = baseFor(route);
    input.context.job.batch_input_hash = 'sha256:' + '0'.repeat(64);
    assert.equal(routes[route](input).errors[0].code, 'NOT_FOUND');
  });
  for (const [name, mutate] of Object.entries(mutations)) for (const field of ['job', 'original-row']) test('noncanonical row context / ' + route + ' / ' + field + ' / ' + name, () => {
    const input = baseFor(route);
    mutate(field === 'job' ? input.context.job : input.context.original_rows[0]);
    rejectsContext(routes[route](input));
  });
  for (const field of ['job', 'original_rows']) test('missing row context / ' + route + ' / ' + field, () => {
    const input = baseFor(route);
    delete input.context[field];
    rejectsContext(routes[route](input));
  });
}
for (const route of ['partialProjection', 'jobProjection']) for (const [name, mutate] of Object.entries(mutations)) test('projection refuses noncanonical job context / ' + route + ' / ' + name, () => {
  const input = baseFor(route);
  mutate(input.context.job);
  rejectsContext(routes[route](input));
});
for (const route of ['row', 'batch', 'pages']) for (const value of [undefined, null, false]) test('missing outer row context / ' + route + ' / ' + value, () => {
  const input = baseFor(route);
  input.context = value;
  rejectsContext(routes[route](input));
});
test('conditional CSV validation grants no parser or launch authority', () => {
  const result = routes.csv(baseFor('csv'));
  assert.equal(result.ok, true);
  assert.equal(result.value.parser_implemented, false);
  assert.equal(result.value.launch_authorized, false);
});
test('disabled CSV remains CAPABILITY_DISABLED', () => {
  const input = baseFor('csv'); input.context.enabled = false;
  assert.equal(routes.csv(input).errors[0].code, 'CAPABILITY_DISABLED');
});
test('canonical enabling mismatch stays CAPABILITY_DISABLED', () => {
  const input = baseFor('csv'); input.context.expected_enabling_ref.revision++;
  assert.equal(routes.csv(input).errors[0].code, 'CAPABILITY_DISABLED');
});
for (const field of ['enabling_ref', 'expected_enabling_ref']) for (const [name, mutate] of Object.entries(mutations)) {
  test('noncanonical CSV context / ' + field + ' / ' + name, () => {
    const input = baseFor('csv'); mutate(input.context[field]);
    rejectsContext(routes.csv(input));
  });
  test('disabled CSV ignores malformed enabling evidence / ' + field + ' / ' + name, () => {
    const input = baseFor('csv'); input.context.enabled = false; mutate(input.context[field]);
    assert.equal(routes.csv(input).errors[0].code, 'CAPABILITY_DISABLED');
  });
}
test('verified-row and checkpoint controls retain their independent hashes', () => {
  assert.equal(hashManifest(frozen.partial.input), 'sha256:015e73a2629d44a59df7820cd5768ad22fa252e3f878f618e26825e177f6cb8b');
  assert.equal(hashManifest(frozen.checkpoint.input), 'sha256:712ac0e5bd3be652ebb7c6e740c402c674828f16eea990ce74996f040577c9dc');
  assert.equal(frozen.provenance.accepted, false);
  assert.equal(frozen.provenance.authority, false);
});
function partialFor(route) {
  const input = copy(frozen.partial.input);
  if (route === 'row') input.value = input.value.rows[0];
  return input;
}
for (const route of ['row', 'batch', 'pages']) {
  test('synthetic visible-row binding remains supported / ' + route, () => assert.equal(routes[route](partialFor(route)).ok, true));
  for (const field of ['artifact_ref', 'bundle_ref', 'job']) {
    for (const [name, mutate] of Object.entries(mutations)) test('noncanonical verified row / ' + route + ' / ' + field + ' / ' + name, () => {
      const input = partialFor(route);
      mutate(input.context.verified_rows.row_1[field]);
      rejectsContext(routes[route](input));
    });
    test('missing verified row reference / ' + route + ' / ' + field, () => {
      const input = partialFor(route);
      delete input.context.verified_rows.row_1[field];
      rejectsContext(routes[route](input));
    });
  }
}
test('synthetic CSV checkpoint validates without authorizing launch', () => {
  const result = routes.csv(copy(frozen.checkpoint.input));
  assert.equal(result.ok, true);
  assert.equal(result.value.launch_authorized, false);
});
for (const [name, mutate] of Object.entries(mutations)) {
  test('noncanonical CSV checkpoint reference / ' + name, () => {
    const input = copy(frozen.checkpoint.input); mutate(input.context.checkpoint_ref);
    rejectsContext(routes.csv(input));
  });
  test('disabled CSV ignores malformed checkpoint reference / ' + name, () => {
    const input = copy(frozen.checkpoint.input); input.context.enabled = false; mutate(input.context.checkpoint_ref);
    assert.equal(routes.csv(input).errors[0].code, 'CAPABILITY_DISABLED');
  });
}
test('missing supplied CSV checkpoint reference rejects', () => {
  const input = copy(frozen.checkpoint.input); delete input.context.checkpoint_ref;
  rejectsContext(routes.csv(input));
});
for (const route of ['row', 'csv']) test('unrelated programming errors remain observable / ' + route, () => {
  const input = baseFor(route), error = new Error('intentional test error');
  const field = route === 'row' ? 'job' : 'enabling_ref';
  input.context[field] = new Proxy(input.context[field], { ownKeys() { throw error; } });
  assert.throws(() => routes[route](input), actual => actual === error);
});
for (const value of [undefined, null, false]) test('structured plan refuses missing outer context / ' + value, () => {
  rejectsContext(checkPersonalizationPlan(copy(request), value));
});
