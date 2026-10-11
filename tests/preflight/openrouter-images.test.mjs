import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalHash } from '../../src/contracts/validation.mjs';
import {
  createOpenRouterImagesAdapter,
  executeAuthorizedAccessCell,
  openRouterCatalogEndpoint,
  runAccessPreflight,
  validateOpenRouterImageTarget,
} from '../../src/preflight/index.mjs';
import { OPENROUTER_FIXTURE_MODEL, accessPlan, createMockAccessFixture, fixtureScope } from '../../fixtures/preflight/access-ports.mjs';

// A fixed, injectable clock: observations, expiries and deadlines never depend on the wall clock.
let nowMs = Date.parse('2031-03-04T05:06:07.000Z');
const clock = () => nowMs;
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const TOKEN_CANARY = 'canary-openrouter-token-never-in-evidence';
const KEY_URL = 'https://openrouter.ai/api/v1/key';
const CATALOG_URL = 'https://openrouter.ai/api/v1/images/models/synthetic-lab/image-model-offline/endpoints';

function target(cellId = 'image_generation') {
  return structuredClone(accessPlan({ cellId, provider: 'openrouter' }).cells.find((cell) => cell.cell_id === cellId).target);
}

function pinned(name) {
  return { ref: `test:evidence:${name}`, sha256: digest(name), pinned_revision: `test:revision:${name}`,
    independent_review: { ref: `test:review:${name}`, sha256: digest(`review:${name}`) } };
}

function credentialPort({ mutate = (value) => value, calls = [] } = {}) {
  return {
    evidence_mode: 'live',
    calls,
    async resolveCredential(input) {
      calls.push(input);
      return mutate({
        decision: 'resolved',
        evidence_mode: 'live',
        binding: { service: 'openrouter', account_ref: input.account_ref, project_ref: input.project_ref,
          target_binding_sha256: digest(JSON.stringify(input.target_binding)) },
        token: TOKEN_CANARY,
        expires_at: new Date(clock() + 60_000).toISOString(),
        evidence: pinned('credential'),
      });
    },
  };
}

const keyBody = { data: { label: 'sk-or-redacted', limit: 4417.3, limit_remaining: 7319.04172, usage: 0.86153, is_free_tier: false } };
const catalogBody = { data: { endpoints: [
  { provider_tag: 'other-provider', supported_parameters: {}, pricing: {} },
  { provider_tag: 'synthetic-provider', supported_parameters: { aspect_ratio: { type: 'enum', values: ['1:1', 'auto'] } }, pricing: { image: '0.0731942' } },
] } };

function interceptedFetch(handlers = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    const handler = handlers[url];
    if (handler === 'throw') throw new Error('network down with secret-detail');
    const { status = 200, body = url === KEY_URL ? keyBody : catalogBody, headers = {} } = handler ?? {};
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  };
  return { fetchImpl, requests };
}

async function inspect(adapter, cellId = 'image_generation') {
  return adapter.inspect({ run_id: 'test:run', cell_id: cellId, target: target(cellId), scope: fixtureScope });
}

test('targets pin service, endpoint, explicit model, provider tag and profile hash, separately per cell', () => {
  assert.doesNotThrow(() => validateOpenRouterImageTarget('image_generation', target('image_generation')));
  assert.doesNotThrow(() => validateOpenRouterImageTarget('image_edit', target('image_edit')));
  const mutations = [
    ['wrong service', (t) => { t.service = 'openai'; }],
    ['direct OpenAI endpoint', (t) => { t.endpoint = 'https://api.openai.com/v1/images/generations'; }],
    ['models endpoint', (t) => { t.endpoint = 'https://openrouter.ai/api/v1/images/models'; }],
    ['bare model name', (t) => { t.model = 'image-model'; }],
    ['null model', (t) => { t.model = null; }],
    ['model with path traversal', (t) => { t.model = 'a/../b'; }],
    ['wrong runtime pin', (t) => { t.sdk.version = '0.0.0'; }],
    ['missing sdk', (t) => { t.sdk = null; }],
    ['missing provider tag', (t) => { delete t.configuration.provider_tag; }],
    ['provider tag with whitespace', (t) => { t.configuration.provider_tag = 'a b'; }],
    ['missing profile hash', (t) => { delete t.configuration.profile_sha256; }],
    ['unpinned profile hash', (t) => { t.configuration.profile_sha256 = 'latest'; }],
    ['unknown configuration key', (t) => { t.configuration.size = '1024x1024'; }],
    ['routing override key', (t) => { t.configuration.fallbacks = true; }],
  ];
  for (const [name, mutate] of mutations) {
    const candidate = target('image_generation');
    mutate(candidate);
    assert.throws(() => validateOpenRouterImageTarget('image_generation', candidate), (error) => error.code === 'unsupported_image_configuration', name);
  }
  const generationWithAsset = target('image_edit');
  assert.throws(() => validateOpenRouterImageTarget('image_generation', generationWithAsset), (error) => error.code === 'unsupported_image_configuration',
    'generation never carries an edit asset');
  for (const field of ['asset_ref', 'asset_sha256', 'asset_mime']) {
    const edit = target('image_edit');
    delete edit.configuration[field];
    assert.throws(() => validateOpenRouterImageTarget('image_edit', edit), (error) => error.code === 'unsupported_image_configuration', field);
  }
  const svg = target('image_edit');
  svg.configuration.asset_mime = 'image/svg+xml';
  assert.throws(() => validateOpenRouterImageTarget('image_edit', svg));
  assert.throws(() => validateOpenRouterImageTarget('planning', target()), (error) => error.code === 'unsupported_image_configuration');
  assert.equal(openRouterCatalogEndpoint(OPENROUTER_FIXTURE_MODEL), CATALOG_URL);
  assert.equal(openRouterCatalogEndpoint('a/b:free'), 'https://openrouter.ai/api/v1/images/models/a/b%3Afree/endpoints');
  assert.throws(() => openRouterCatalogEndpoint('a/b/c'));
  assert.throws(() => openRouterCatalogEndpoint('../x/y'));
});

test('metadata adapter makes two intercepted non-billable GETs and reports permission and quota as unknown', async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'env-canary-must-never-be-read';
  try {
    for (const cellId of ['image_generation', 'image_edit']) {
      const { fetchImpl, requests } = interceptedFetch();
      const port = credentialPort();
      const observation = await inspect(createOpenRouterImagesAdapter({ now: clock, credentialPort: port, fetchImpl }), cellId);
      assert.deepEqual(requests.map((request) => request.url), [KEY_URL, CATALOG_URL]);
      for (const { init } of requests) {
        assert.equal(init.method, 'GET');
        assert.equal(init.redirect, 'error');
        assert.equal(init.body, undefined);
      }
      assert.equal(requests[0].init.headers.authorization, `Bearer ${TOKEN_CANARY}`);
      assert.deepEqual(Object.keys(requests[1].init.headers), ['accept'], 'the public catalog never receives the credential');
      assert.equal(port.calls.length, 1);
      assert.equal(port.calls[0].purpose, 'read_only_account_check');
      assert.equal(port.calls[0].service, 'openrouter');
      assert.equal(observation.authentication, 'confirmed');
      assert.equal(observation.model_listing, 'listed');
      assert.equal(observation.operation_permission, 'unknown');
      assert.equal(observation.quota, 'unknown');
      assert.equal(observation.target.service, 'openrouter');
      assert.equal(observation.target.model, OPENROUTER_FIXTURE_MODEL);
      const serialized = JSON.stringify(observation);
      for (const secret of [TOKEN_CANARY, 'env-canary-must-never-be-read', 'sk-or-redacted', '7319.04172', '0.86153', '4417.3', '0.0731942']) {
        assert.ok(!serialized.includes(secret), `observation leaked ${secret}`);
      }
      assert.equal(observation.checked_at, new Date(nowMs).toISOString(), 'checked_at comes from the injected clock');
      const forbiddenKeys = ['limit', 'limit_remaining', 'usage', 'is_free_tier', 'label', 'pricing'];
      const keysOf = (value) => (value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]) : []);
      assert.deepEqual(keysOf(observation).filter((key) => forbiddenKeys.includes(key)), [], 'no balance, usage or pricing field is retained');
      assert.match(observation.evidence.sha256, /^sha256:[a-f0-9]{64}$/);
    }
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous;
  }
});

test('key and catalog outcomes map to authentication and listing without claiming entitlement', async () => {
  const cases = [
    ['invalid key', { [KEY_URL]: { status: 401, body: { error: { message: 'No auth credentials found' } } } }, { authentication: 'denied', model_listing: 'listed' }],
    ['forbidden key read', { [KEY_URL]: { status: 403, body: {} } }, { authentication: 'unknown', model_listing: 'listed' }],
    ['rate limited key read', { [KEY_URL]: { status: 429, body: {} } }, { authentication: 'unknown', model_listing: 'listed' }],
    ['malformed key body', { [KEY_URL]: { status: 200, body: { data: 'nope' } } }, { authentication: 'unknown', model_listing: 'listed' }],
    ['model absent', { [CATALOG_URL]: { status: 404, body: {} } }, { authentication: 'confirmed', model_listing: 'not_listed' }],
    ['provider tag not offered', { [CATALOG_URL]: { body: { data: { endpoints: [{ provider_tag: 'other-provider' }] } } } }, { authentication: 'confirmed', model_listing: 'not_listed' }],
    ['array catalog shape', { [CATALOG_URL]: { body: { data: [{ provider_tag: 'synthetic-provider' }] } } }, { authentication: 'confirmed', model_listing: 'listed' }],
    ['unrecognized catalog shape', { [CATALOG_URL]: { body: { surprise: true } } }, { authentication: 'confirmed', model_listing: 'unknown' }],
    ['catalog server error', { [CATALOG_URL]: { status: 500, body: {} } }, { authentication: 'confirmed', model_listing: 'unknown' }],
    ['oversized catalog', { [CATALOG_URL]: { headers: { 'content-length': String(64 * 1024 * 1024) } } }, { authentication: 'confirmed', model_listing: 'unknown' }],
  ];
  for (const [name, handlers, expected] of cases) {
    const { fetchImpl } = interceptedFetch(handlers);
    const observation = await inspect(createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialPort(), fetchImpl }));
    assert.equal(observation.authentication, expected.authentication, name);
    assert.equal(observation.model_listing, expected.model_listing, name);
    assert.equal(observation.operation_permission, 'unknown', name);
    assert.equal(observation.quota, 'unknown', name);
  }
  for (const url of [KEY_URL, CATALOG_URL]) {
    const { fetchImpl } = interceptedFetch({ [url]: 'throw' });
    await assert.rejects(inspect(createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialPort(), fetchImpl })),
      (error) => error.code === 'access_probe_unavailable' && !String(error.message).includes('secret-detail'));
  }
});

test('invalid targets and credentials stop before any request, and construction needs explicit ports', async () => {
  const wrongTarget = target();
  wrongTarget.endpoint = 'https://api.openai.com/v1/images/generations';
  const { fetchImpl, requests } = interceptedFetch();
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialPort(), fetchImpl });
  await assert.rejects(adapter.inspect({ run_id: 'test:run', cell_id: 'image_generation', target: wrongTarget, scope: fixtureScope }),
    (error) => error.code === 'unsupported_image_configuration');
  for (const [name, mutate] of [
    ['unresolved', (value) => ({ ...value, decision: 'denied' })],
    ['mock evidence', (value) => ({ ...value, evidence_mode: 'mock' })],
    ['wrong service binding', (value) => ({ ...value, binding: { ...value.binding, service: 'openai' } })],
    ['wrong account', (value) => ({ ...value, binding: { ...value.binding, account_ref: 'other-account' } })],
    ['wrong target hash', (value) => ({ ...value, binding: { ...value.binding, target_binding_sha256: digest('other') } })],
    ['extra binding field', (value) => ({ ...value, binding: { ...value.binding, grant_ref: 'x' } })],
    ['multi-line token', (value) => ({ ...value, token: 'a\nb' })],
    ['expired credential', (value) => ({ ...value, expires_at: new Date(clock() - 1000).toISOString() })],
    ['unpinned evidence', (value) => ({ ...value, evidence: { ref: 'x' } })],
  ]) {
    const adapterWithBadPort = createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialPort({ mutate }), fetchImpl });
    await assert.rejects(inspect(adapterWithBadPort), (error) => error.code === 'credential_unavailable', name);
  }
  assert.equal(requests.length, 0, 'no request is sent before the exact credential binding is verified');
  assert.throws(() => createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialPort() }), (error) => error.code === 'adapter_unavailable');
  assert.throws(() => createOpenRouterImagesAdapter({ now: clock, credentialPort: { ...credentialPort(), evidence_mode: 'mock' }, fetchImpl }),
    (error) => error.code === 'credential_unavailable');
  assert.throws(() => createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialPort(), fetchImpl, dispatchPort: {} }),
    (error) => error.code === 'adapter_unavailable');
});

const GRANT = 'grant:test:1';
const deadline = (offsetMs = 120_000) => new Date(clock() + offsetMs).toISOString();
const billable = (cellId = 'image_generation', overrides = {}) => ({ run_id: 'test:run', cell_id: cellId, target: target(cellId),
  configuration: target(cellId).configuration, scope: fixtureScope, grant_ref: GRANT, deadline_at: deadline(), ...overrides });
// A credential port that honors grant_ref like a real resolver would, with per-test mutation of the answer.
function grantCredentialPort({ mutate = (value) => value, calls = [] } = {}) {
  return credentialPort({ calls, mutate: (value) => mutate({ ...value,
    binding: { ...value.binding, ...(calls.at(-1)?.grant_ref ? { grant_ref: calls.at(-1).grant_ref } : {}) },
    expires_at: new Date(clock() + 600_000).toISOString() }) });
}

test('the clock option must be a function returning a finite number', () => {
  const { fetchImpl } = interceptedFetch();
  for (const now of [5, 'now', null, () => NaN, () => 'x', () => Infinity]) {
    assert.throws(() => createOpenRouterImagesAdapter({ credentialPort: credentialPort(), fetchImpl, now }), (error) => error.code === 'adapter_unavailable', String(now));
  }
  assert.doesNotThrow(() => createOpenRouterImagesAdapter({ credentialPort: credentialPort(), fetchImpl }));
});

test('billable dispatch exists only through a trusted host port and re-checks the OpenRouter pin', async () => {
  const { fetchImpl, requests } = interceptedFetch();
  const bare = createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialPort(), fetchImpl });
  assert.equal(bare.prepare, undefined);
  await assert.rejects(bare.dispatch({ cell_id: 'image_generation', target: target() }), (error) => error.code === 'adapter_unavailable');
  const seen = [];
  const calls = [];
  const composed = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort({ calls }), fetchImpl, dispatchPort: {
    async prepare(input) { seen.push(['prepare', input.cell_id, input.credential.token]); return { host_prepared: input.cell_id }; },
    async dispatch(input) { seen.push(['dispatch', input.cell_id, input.credential.token, input.prepared, input.signal instanceof AbortSignal]); return { host: 'result' }; },
  } });
  const input = billable('image_edit');
  const prepared = await composed.prepare(input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].purpose, 'authorized_billable_operation', 'billable operations resolve the authorized_billable_operation purpose');
  assert.equal(calls[0].grant_ref, GRANT);
  assert.ok(!JSON.stringify(prepared).includes(TOKEN_CANARY), 'the credential is not in the value the runner holds');
  assert.deepEqual(await composed.dispatch({ ...input, prepared }), { host: 'result' });
  assert.deepEqual(seen, [['prepare', 'image_edit', TOKEN_CANARY], ['dispatch', 'image_edit', TOKEN_CANARY, { host_prepared: 'image_edit' }, true]]);
  // The pin is re-checked on both entry points, and a dispatch needs a prepared value this adapter minted.
  const wrong = billable('image_generation');
  wrong.target.service = 'openai';
  await assert.rejects(composed.prepare(wrong), (error) => error.code === 'unsupported_image_configuration');
  const before = seen.length;
  const ok = billable('image_generation');
  const okPrepared = await composed.prepare(ok);
  for (const [name, bad] of [
    ['no prepared value', { ...ok, prepared: undefined }],
    ['forged prepared value', { ...ok, prepared: { prepared: true } }],
    ['prepared from another cell', { ...ok, prepared }],
    ['different grant', { ...ok, prepared: okPrepared, grant_ref: 'grant:other' }],
    ['different deadline', { ...ok, prepared: okPrepared, deadline_at: deadline(10_000) }],
    ['different target object', { ...ok, prepared: okPrepared, target: target('image_generation') }],
    ['mismatched pin', { ...ok, prepared: okPrepared, target: wrong.target }],
  ]) await assert.rejects(composed.dispatch(bad), (error) => ['credential_unavailable', 'unsupported_image_configuration'].includes(error.code), name);
  assert.equal(seen.filter(([kind]) => kind === 'dispatch').length, 1, 'no rejected dispatch reached the host port');
  assert.equal(seen.length, before + 1, 'only the one valid prepare ran after the rejections');
  assert.equal(requests.length, 0, 'the metadata adapter never sends a paid request');
  // A port without prepare still gets a credential-bound prepare step.
  const noPrepare = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl, dispatchPort: {
    async dispatch(input) { return { token_seen: input.credential.token === TOKEN_CANARY, prepared: input.prepared }; } } });
  assert.deepEqual(await noPrepare.dispatch({ ...ok, prepared: await noPrepare.prepare(ok) }), { token_seen: true, prepared: undefined });
});

test('billable prepare resolves a grant-bound credential through the deadline, or no host port runs', async () => {
  const { fetchImpl } = interceptedFetch();
  const hostCalls = [];
  const dispatchPort = { async prepare() { hostCalls.push('prepare'); return {}; }, async dispatch() { hostCalls.push('dispatch'); return {}; } };
  const adapterFor = (mutate) => createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort({ mutate }), fetchImpl, dispatchPort });
  const bound = (value) => ({ ...value, binding: { ...value.binding } });
  const cases = [
    ['mismatched grant in the binding', adapterFor((value) => ({ ...bound(value), binding: { ...value.binding, grant_ref: 'grant:other' } })), billable()],
    ['binding without any grant', adapterFor((value) => { const copy = bound(value); delete copy.binding.grant_ref; return copy; }), billable()],
    ['expiry before the deadline', adapterFor((value) => ({ ...value, expires_at: new Date(clock() + 30_000).toISOString() })),
      billable('image_generation', { deadline_at: deadline(90_000) })],
    ['already expired', adapterFor((value) => ({ ...value, expires_at: new Date(clock() - 1000).toISOString() })), billable()],
    ['wrong purpose refused by the resolver', createOpenRouterImagesAdapter({ now: clock, fetchImpl, dispatchPort, credentialPort: {
      evidence_mode: 'live', async resolveCredential(input) { return { decision: input.purpose === 'read_only_account_check' ? 'resolved' : 'denied' }; } } }), billable()],
    ['wrong account', adapterFor((value) => ({ ...value, binding: { ...value.binding, account_ref: 'other-account' } })), billable()],
    ['missing grant reference', adapterFor((value) => value), billable('image_generation', { grant_ref: undefined })],
    ['missing deadline', adapterFor((value) => value), billable('image_generation', { deadline_at: undefined })],
    ['deadline already passed', adapterFor((value) => value), billable('image_generation', { deadline_at: deadline(-1000) })],
  ];
  for (const [name, adapter, input] of cases) {
    await assert.rejects(adapter.prepare(input), (error) => error.code === 'credential_unavailable' && !String(error.message).includes(TOKEN_CANARY), name);
  }
  assert.deepEqual(hostCalls, [], 'no host port call for any rejected credential');
  // A credential expiring exactly at the deadline is accepted; one second earlier is not.
  const at = deadline(90_000);
  const exact = adapterFor((value) => ({ ...value, expires_at: at }));
  await assert.doesNotReject(exact.prepare(billable('image_generation', { deadline_at: at })));
  assert.deepEqual(hostCalls, ['prepare']);
  // The deadline can also pass between prepare and dispatch.
  const soon = deadline(50);
  const late = adapterFor((value) => ({ ...value, expires_at: new Date(clock() + 600_000).toISOString() }));
  const input = billable('image_generation', { deadline_at: soon });
  const prepared = await late.prepare(input);
  nowMs += 80; // the injected clock passes the deadline between prepare and dispatch
  await assert.rejects(late.dispatch({ ...input, prepared }), (error) => error.code === 'preflight_deadline_passed');
  assert.deepEqual(hostCalls, ['prepare', 'prepare']);
});

test('model_listing is tag presence unless the target pins the catalog entry hash; a different live entry is unknown', async () => {
  const run = async (mutateTarget, handlers) => {
    const { fetchImpl } = interceptedFetch(handlers);
    const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialPort(), fetchImpl });
    const pinned = target();
    mutateTarget(pinned);
    return adapter.inspect({ run_id: 'test:run', cell_id: 'image_generation', target: pinned, scope: fixtureScope });
  };
  const absent = await run(() => {});
  assert.equal(absent.model_listing, 'listed', 'without a pinned hash, listed means the provider tag is present');
  // The pin is the hash this module computes over the fixture's live entry.
  const entry = catalogBody.data.endpoints[1];
  const expected = canonicalHash({ provider_tag: entry.provider_tag, supported_parameters: entry.supported_parameters, pricing: entry.pricing });
  const matched = await run((t) => { t.configuration.catalog_entry_sha256 = expected; });
  assert.equal(matched.model_listing, 'listed');
  const changed = { data: { endpoints: [{ ...entry, pricing: { image: '0.99' } }] } };
  const mismatch = await run((t) => { t.configuration.catalog_entry_sha256 = expected; }, { [CATALOG_URL]: { body: changed } });
  assert.equal(mismatch.model_listing, 'unknown');
  assert.notEqual(mismatch.evidence.sha256, matched.evidence.sha256);
  const unpinnedChanged = await run(() => {}, { [CATALOG_URL]: { body: changed } });
  assert.equal(unpinnedChanged.model_listing, 'listed', 'documented: tag presence only without a pinned hash');
  // A tag that is absent stays not_listed, pinned or not; the pin must be a sha256 string and is bound into the config hash.
  const gone = await run((t) => { t.configuration.catalog_entry_sha256 = expected; }, { [CATALOG_URL]: { body: { data: { endpoints: [] } } } });
  assert.equal(gone.model_listing, 'not_listed');
  for (const bad of ['latest', [expected], 5, null]) {
    const candidate = target();
    candidate.configuration.catalog_entry_sha256 = bad;
    assert.throws(() => validateOpenRouterImageTarget('image_generation', candidate), (error) => error.code === 'unsupported_image_configuration');
  }
  for (const key of ['profile_sha256', 'prompt_template_sha256']) {
    const candidate = target();
    candidate.configuration[key] = [candidate.configuration[key]];
    assert.throws(() => validateOpenRouterImageTarget('image_generation', candidate), (error) => error.code === 'unsupported_image_configuration', `${key} array`);
  }
  // The runner derives the target's configuration_sha256 from the whole configuration, so the pin is bound by it.
  const withPin = target();
  withPin.configuration.catalog_entry_sha256 = expected;
  assert.notEqual(canonicalHash(withPin.configuration), target().configuration_sha256);
});

test('OpenRouter generation and edit are separate cells with independent evidence in the fixed eight-cell matrix', async () => {
  const results = {};
  for (const cellId of ['image_generation', 'image_edit']) {
    const fixture = createMockAccessFixture({ cellId, provider: 'openrouter' });
    assert.equal(fixture.target.service, 'openrouter');
    assert.equal(fixture.meteringRequest.provider.name, 'openrouter');
    assert.equal(fixture.meteringRequest.provider.endpoint, 'https://openrouter.ai/api/v1/images');
    const report = await runAccessPreflight(fixture.args);
    assert.equal(report.mode, 'mock');
    assert.equal(report.acceptance_allowed, false);
    assert.equal(report.required_cell_count, 8);
    assert.equal(report.verified_cell_count, 0);
    assert.equal(report.cells.length, 8);
    const other = cellId === 'image_generation' ? 'image_edit' : 'image_generation';
    assert.equal(report.cells.find((cell) => cell.cell_id === cellId).status, 'simulated');
    assert.equal(report.cells.find((cell) => cell.cell_id === other).status, 'blocked', 'the other image cell gains no evidence');
    assert.equal(fixture.calls.dispatch, 1);
    results[cellId] = fixture;
  }
  assert.notEqual(results.image_generation.target.configuration_sha256, results.image_edit.target.configuration_sha256);
});

test('the metadata observation never supplies permission or quota: the capability verifier decides, and a live adapter cannot run in a mock run', async () => {
  const { fetchImpl, requests } = interceptedFetch();
  const fixtureNow = new Date(Date.now() + 5000).toISOString();
  const real = createOpenRouterImagesAdapter({ now: () => Date.parse(fixtureNow), credentialPort: credentialPort(), fetchImpl });
  const unknownVerifier = (input) => ({
    decision: 'unknown', evidence_mode: 'mock', cell_id: input.cell_id, owner_role: input.owner_role, operation_kind: input.operation_kind,
    target_binding: input.target_binding, scope: input.scope, deadline_at: input.deadline_at,
    operation_permission: 'unknown', quota: 'unknown', checked_at: input.at,
    expires_at: new Date(Date.parse(input.deadline_at) + 1000).toISOString(),
    evidence: pinned('cap'), owner_evidence: { ...pinned('owner'), owner_role: input.owner_role }, protocol: pinned('protocol'),
  });
  const fixture = createMockAccessFixture({ cellId: 'image_generation', provider: 'openrouter', capabilityDecision: unknownVerifier,
    now: fixtureNow });
  // A mock-labeled wrapper stands in for the real adapter's observation; the runner must still ignore its permission/quota.
  // The wrapper deliberately claims every positive value the observation shape allows. If the runner trusted the
  // adapter for permission or quota, this test would fail.
  const wrapped = { ...fixture.adapter, evidence_mode: 'mock',
    async inspect(input) {
      return { ...(await real.inspect(input)), evidence_mode: 'mock', operation_permission: 'confirmed', quota: 'available' };
    } };
  const result = await executeAuthorizedAccessCell({ ...fixture.args, adapter: wrapped });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'operation_permission_unknown');
  assert.equal(result.capability_observation.authentication, 'confirmed');
  assert.equal(result.capability_observation.operation_permission, 'unknown');
  assert.equal(result.capability_observation.quota, 'unknown');
  // When the capability verifier cannot answer, the retained observation is the adapter's: it must still carry unknown.
  const failing = createMockAccessFixture({ cellId: 'image_generation', provider: 'openrouter',
    capabilityDecision: () => { throw new Error('verifier unavailable'); }, now: fixtureNow });
  const unverified = await executeAuthorizedAccessCell({ ...failing.args,
    adapter: { ...failing.adapter, evidence_mode: 'mock', inspect: wrapped.inspect } });
  assert.equal(unverified.status, 'unknown');
  assert.equal(unverified.reason_code, 'capability_verification_unavailable');
  assert.equal(unverified.capability_observation.operation_permission, 'unknown');
  assert.equal(unverified.capability_observation.quota, 'unknown');
  assert.equal(failing.calls.dispatch, 0);
  assert.equal(failing.calls.reserve, 0);
  assert.equal(fixture.calls.dispatch, 0);
  assert.equal(fixture.calls.reserve, 0);
  assert.equal(requests.length, 4, 'two inspections of two requests each');

  const live = await executeAuthorizedAccessCell({ ...createMockAccessFixture({ cellId: 'image_generation', provider: 'openrouter', now: fixtureNow }).args, adapter: real });
  assert.equal(live.status, 'blocked');
  assert.equal(live.reason_code, 'mock_requires_fixture_ports');
  assert.equal(requests.length, 4, 'the live adapter is not invoked by a mock run');
});

test('a clock that turns non-finite after construction fails closed on prepare, dispatch, and inspect without reaching a host port', async () => {
  for (const bad of [NaN, Infinity, undefined, 'x']) {
    let reading = Date.parse('2031-03-04T05:06:07.000Z');
    const badClock = () => reading;
    const { fetchImpl, requests } = interceptedFetch();
    const hostCalls = [];
    const adapter = createOpenRouterImagesAdapter({ now: badClock, credentialPort: grantCredentialPort(), fetchImpl, dispatchPort: {
      async prepare() { hostCalls.push('prepare'); return {}; },
      async dispatch() { hostCalls.push('dispatch'); return {}; } } });
    const input = billable('image_generation', { deadline_at: new Date(reading + 120_000).toISOString() });
    const prepared = await adapter.prepare(input);
    reading = bad;
    await assert.rejects(adapter.prepare(input), (error) => error.code === 'adapter_unavailable', `prepare ${String(bad)}`);
    await assert.rejects(adapter.dispatch({ ...input, prepared }), (error) => error.code === 'adapter_unavailable', `dispatch ${String(bad)}`);
    await assert.rejects(inspect(adapter), (error) => error.code === 'adapter_unavailable', `inspect ${String(bad)}`);
    assert.deepEqual(hostCalls, ['prepare'], 'only the prepare made while the clock was valid reached the host');
    assert.equal(requests.length, 0, 'inspect sent no metadata request');
  }
});

test('the host dispatch signal combines the runner cancellation signal with the deadline timeout', async () => {
  const seen = [];
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch(input) { seen.push(input.signal); return {}; } } });
  const input = billable();
  const caller = new AbortController();
  await adapter.dispatch({ ...input, prepared: await adapter.prepare(input), metering: { signal: caller.signal } });
  assert.equal(seen[0].aborted, false);
  caller.abort();
  assert.equal(seen[0].aborted, true, 'aborting the caller signal aborts the host-facing signal');
  // Without a caller signal the host still gets a deadline-bound signal, and a non-signal value is refused.
  await adapter.dispatch({ ...input, prepared: await adapter.prepare(input) });
  assert.ok(seen[1] instanceof AbortSignal && seen[1].aborted === false);
  await assert.rejects(adapter.dispatch({ ...input, prepared: await adapter.prepare(input), metering: { signal: {} } }),
    (error) => error.code === 'adapter_unavailable');
  assert.equal(seen.length, 2);
  // The deadline still aborts the host-facing signal (a 5 ms remaining deadline on a fixed clock that the signal timer outlives).
  const short = billable('image_generation', { deadline_at: new Date(clock() + 5).toISOString() });
  await adapter.dispatch({ ...short, prepared: await adapter.prepare(short), metering: { signal: new AbortController().signal } });
  // AbortSignal.timeout timers are unref'd, so a ref'd timer keeps the loop alive while the abort event is awaited.
  const keepAlive = setTimeout(() => {}, 5_000);
  await new Promise((resolve) => seen[2].addEventListener('abort', resolve, { once: true }));
  clearTimeout(keepAlive);
  assert.equal(seen[2].aborted, true);
});

test('a prepared value is single use and bound to the scope it was prepared for', async () => {
  let dispatches = 0;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch() { dispatches += 1; return {}; } } });
  const input = billable();
  const prepared = await adapter.prepare(input);
  await assert.rejects(adapter.dispatch({ ...input, prepared, scope: { ...input.scope, project_ref: 'project:other' } }),
    (error) => error.code === 'credential_unavailable');
  assert.equal(dispatches, 0, 'a scope mismatch never reaches the host and does not consume the value');
  await adapter.dispatch({ ...input, prepared });
  await assert.rejects(adapter.dispatch({ ...input, prepared }), (error) => error.code === 'credential_unavailable');
  assert.equal(dispatches, 1, 'the replay was refused before the host port');
});

test('prepare re-checks the deadline after the credential await and never calls the host prepare once it has passed', async () => {
  for (const [name, phase, change, code] of [
    ['deadline passes after resolution', 'after', (r) => r + 200_000, 'preflight_deadline_passed'],
    ['clock fault during resolution fails closed in the credential step', 'before', () => NaN, 'credential_unavailable']]) {
    let reading = clock();
    const inner = grantCredentialPort();
    const hostCalls = [];
    const credentialSource = { evidence_mode: 'live', async resolveCredential(args) {
      if (phase === 'before') reading = change(reading);
      const result = await inner.resolveCredential(args);
      if (phase === 'after') reading = change(reading);
      return result;
    } };
    const adapter = createOpenRouterImagesAdapter({ now: () => reading, credentialPort: credentialSource, fetchImpl: interceptedFetch().fetchImpl,
      dispatchPort: { async prepare() { hostCalls.push('prepare'); return {}; }, async dispatch() { hostCalls.push('dispatch'); return {}; } } });
    const input = billable('image_generation', { deadline_at: new Date(reading + 120_000).toISOString() });
    await assert.rejects(adapter.prepare(input), (error) => error.code === code, name);
    assert.deepEqual(hostCalls, [], name);
  }
});

test('prepare stores a copy of the scope, so later mutation of the caller object does not change the binding', async () => {
  let dispatches = 0;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch() { dispatches += 1; return {}; } } });
  const input = billable();
  const original = { account_ref: input.scope.account_ref, project_ref: input.scope.project_ref };
  const callerScope = { ...input.scope };
  const prepared = await adapter.prepare({ ...input, scope: callerScope });
  callerScope.project_ref = 'project:other';
  await assert.rejects(adapter.dispatch({ ...input, scope: callerScope, prepared }), (error) => error.code === 'credential_unavailable');
  assert.equal(dispatches, 0, 'a mutated caller scope no longer matches the stored copy');
  await adapter.dispatch({ ...input, scope: original, prepared });
  assert.equal(dispatches, 1);
});

test('a host prepare that mutates the scope it received cannot move the binding, and the host scope is frozen', async () => {
  let dispatches = 0;
  let hostScope;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async prepare(args) {
      hostScope = args.scope;
      assert.ok(Object.isFrozen(args.scope), 'the host gets a frozen snapshot, not the caller object');
      assert.notEqual(args.scope, input.scope);
      assert.throws(() => { 'use strict'; args.scope.project_ref = 'project:host'; }, TypeError);
      // The caller's live object is the only mutable path left; mutating it during the host await must not matter.
      input.scope.account_ref = 'account:host';
      input.scope.project_ref = 'project:host';
      return {};
    },
    async dispatch() { dispatches += 1; return {}; } } });
  const input = billable('image_generation', { scope: { ...fixtureScope } });
  const original = { ...fixtureScope };
  const prepared = await adapter.prepare(input);
  assert.deepEqual({ ...hostScope }, original, 'the host saw the original refs, not the mutated ones');
  await assert.rejects(adapter.dispatch({ ...input, prepared }), (error) => error.code === 'credential_unavailable');
  assert.equal(dispatches, 0, 'the mutated scope no longer matches the bound scope');
  await adapter.dispatch({ ...input, scope: original, prepared });
  assert.equal(dispatches, 1);
});

test('a host prepare that mutates the validated target fails closed, and replacing its own target property changes nothing', async () => {
  let dispatches = 0;
  const mutations = [
    ['model field', (t) => { t.model = 'other-author/other-model'; }],
    ['configuration field', (t) => { t.configuration.provider_tag = 'other-tag'; }],
    ['target made invalid', (t) => { t.endpoint = 'https://example.invalid/'; }]];
  for (const [name, mutate] of mutations) {
    const input = billable();
    const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
      async prepare() { mutate(input.target); return {}; },
      async dispatch() { dispatches += 1; return {}; } } });
    await assert.rejects(adapter.prepare(input), (error) => error.code === 'unsupported_image_configuration', name);
  }
  assert.equal(dispatches, 0);
  const input = billable();
  const bound = input.target;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async prepare(args) { args.target = { ...args.target, model: 'other-author/other-model' }; args.grant_ref = 'grant:other'; return {}; },
    async dispatch() { dispatches += 1; return {}; } } });
  const prepared = await adapter.prepare(input);
  await adapter.dispatch({ ...input, target: bound, prepared });
  assert.equal(dispatches, 1, 'a host that rewrites its own copy of the input leaves the binding on the validated target and grant');
});

test('a caller mutating input.scope while the credential resolver is awaiting does not change the binding', async () => {
  let dispatches = 0;
  const inner = grantCredentialPort();
  const input = billable('image_generation', { scope: { ...fixtureScope } });
  const original = { ...fixtureScope };
  const credentialSource = { evidence_mode: 'live', async resolveCredential(args) {
    const result = inner.resolveCredential(args);
    input.scope.project_ref = 'project:swapped';
    return result;
  } };
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialSource, fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch() { dispatches += 1; return {}; } } });
  const prepared = await adapter.prepare(input);
  await assert.rejects(adapter.dispatch({ ...input, prepared }), (error) => error.code === 'credential_unavailable');
  assert.equal(dispatches, 0);
  await adapter.dispatch({ ...input, scope: original, prepared });
  assert.equal(dispatches, 1);
});

test('prepare fails closed with credential_unavailable when the scope is not a record of string refs', async () => {
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async prepare() { throw new Error('host prepare must not run'); }, async dispatch() { return {}; } } });
  for (const scope of [undefined, null, [], { account_ref: 1, project_ref: 'p' }, { account_ref: 'a' }]) {
    await assert.rejects(adapter.prepare(billable('image_generation', { scope })), (error) => error.code === 'credential_unavailable');
  }
});

test('a target mutated between prepare and dispatch is refused before the host dispatch, and consumes the prepared value', async () => {
  for (const [name, mutate] of [
    ['model', (t) => { t.model = 'evil-author/evil-model'; }],
    ['nested configuration.provider_tag', (t) => { t.configuration.provider_tag = 'evil-tag'; }]]) {
    let dispatches = 0;
    const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
      async dispatch() { dispatches += 1; return {}; } } });
    const input = billable();
    const prepared = await adapter.prepare(input);
    mutate(input.target);
    await assert.rejects(adapter.dispatch({ ...input, prepared }), (error) => error.code === 'unsupported_image_configuration', name);
    assert.equal(dispatches, 0, name);
    await assert.rejects(adapter.dispatch({ ...input, prepared }), (error) => error.code === 'credential_unavailable', `${name}: single use`);
  }
});

test('a caller changing grant_ref, deadline_at, or cell_id during the credential await does not change the binding', async () => {
  let dispatches = 0;
  const inner = grantCredentialPort();
  const input = billable();
  const original = { cell_id: input.cell_id, grant_ref: input.grant_ref, deadline_at: input.deadline_at };
  const credentialSource = { evidence_mode: 'live', async resolveCredential(args) {
    const result = inner.resolveCredential(args);
    input.grant_ref = 'grant:test:other';
    input.deadline_at = deadline(60_000);
    input.cell_id = 'image_edit';
    return result;
  } };
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialSource, fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch() { dispatches += 1; return {}; } } });
  const prepared = await adapter.prepare(input);
  // The mutated cell_id fails target validation first; the mutated grant and deadline fail the binding check.
  await assert.rejects(adapter.dispatch({ ...input, prepared }), (error) => error.code === 'unsupported_image_configuration');
  await assert.rejects(adapter.dispatch({ ...input, cell_id: original.cell_id, prepared }), (error) => error.code === 'credential_unavailable');
  assert.equal(dispatches, 0);
  await adapter.dispatch({ ...input, ...original, prepared });
  assert.equal(dispatches, 1);
});

test('a target mutated during the credential await fails closed before the host prepare', async () => {
  const inner = grantCredentialPort();
  const input = billable();
  let hostCalls = 0;
  const credentialSource = { evidence_mode: 'live', async resolveCredential(args) {
    const result = inner.resolveCredential(args);
    input.target.configuration.provider_tag = 'evil-tag';
    return result;
  } };
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialSource, fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async prepare() { hostCalls += 1; return {}; }, async dispatch() { return {}; } } });
  await assert.rejects(adapter.prepare(input), (error) => error.code === 'unsupported_image_configuration');
  assert.equal(hostCalls, 0);
});

test('a throwing scope getter fails closed as credential_unavailable', async () => {
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async prepare() { throw new Error('host prepare must not run'); }, async dispatch() { return {}; } } });
  const scope = { account_ref: fixtureScope.account_ref, get project_ref() { throw new Error('boom'); } };
  await assert.rejects(adapter.prepare(billable('image_generation', { scope })), (error) => error.code === 'credential_unavailable');
});

test('fields the validator and binding never read do not affect the target digest, and the host sees the bound configuration', async () => {
  let dispatches = 0;
  let hostConfiguration;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch(args) { dispatches += 1; hostConfiguration = args.configuration; return {}; } } });
  const input = billable();
  input.target.note = undefined;
  input.target.when = new Date();
  input.target.ratio = NaN;
  const prepared = await adapter.prepare(input);
  input.target.ratio = Infinity;
  await adapter.dispatch({ ...input, configuration: { divergent: true }, prepared });
  assert.equal(dispatches, 1);
  assert.equal(hostConfiguration, input.target.configuration, 'a divergent top-level configuration never reaches the host');
});

test('a caller getter that mutates the target while dispatch reads its input is refused before the host dispatch', async () => {
  for (const [name, install] of [
    ['enumerable property spread into the host args', (din, evil) => Object.defineProperty(din, 'zz_late', { enumerable: true, get() { evil(); return 1; } })],
    ['metering getter', (din, evil) => Object.defineProperty(din, 'metering', { enumerable: true, get() { evil(); return undefined; } })]]) {
    let dispatches = 0;
    const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
      async dispatch() { dispatches += 1; return {}; } } });
    const input = billable();
    const prepared = await adapter.prepare(input);
    const din = { ...input, prepared };
    install(din, () => { input.target.model = 'evil-author/evil-model'; });
    await assert.rejects(adapter.dispatch(din), (error) => error.code === 'unsupported_image_configuration', name);
    assert.equal(dispatches, 0, name);
  }
});
