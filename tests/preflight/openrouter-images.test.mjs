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

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

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
const meteringInput = (signal = new AbortController().signal) => ({ signal });
const dispatchInput = (input, prepared, signal = new AbortController().signal) => ({ ...input, prepared, metering: meteringInput(signal) });
// A credential port that honors grant_ref like a real resolver would, with per-test mutation of the answer.
function grantCredentialPort({ mutate = (value) => value, calls = [] } = {}) {
  return credentialPort({ calls, mutate: (value) => mutate({ ...value,
    binding: { ...value.binding, ...(calls.at(-1)?.grant_ref ? { grant_ref: calls.at(-1).grant_ref } : {}) },
    expires_at: new Date(clock() + 600_000).toISOString() }) });
}

function markLive(port, methods, transform = (decision) => decision) {
  port.evidence_mode = 'live';
  for (const name of methods) {
    const method = port[name].bind(port);
    port[name] = async (input) => ({ ...transform(await method(input), input), evidence_mode: 'live' });
  }
}

function createLiveOpenRouterRunner({ signal, deadlineOffsetMs, prepareHost, dispatchHost } = {}) {
  const fixture = createMockAccessFixture({ cellId: 'image_generation', provider: 'openrouter' });
  if (deadlineOffsetMs !== undefined) fixture.cell.spend.deadline_at = new Date(Date.now() + deadlineOffsetMs).toISOString();
  markLive(fixture.pinVerifier, ['verifyPin']);
  markLive(fixture.capabilityVerifier, ['verifyCapability', 'revalidateCapability']);
  markLive(fixture.authorizationPort, ['verifyGrant', 'revalidateGrant'], (decision) => {
    decision.grant.expires_at = new Date(Date.parse(fixture.cell.spend.deadline_at) - 100).toISOString();
    return decision;
  });
  markLive(fixture.reservationVerifier, ['verifyReservation']);
  fixture.authority.evidence_mode = 'live';

  const credentialCalls = [];
  const resolvedCredentials = [];
  const credentialResolver = {
    evidence_mode: 'live',
    async resolveCredential(input) {
      credentialCalls.push(input);
      const deadlineAt = Date.parse(fixture.cell.spend.deadline_at);
      const resolved = {
        decision: 'resolved',
        evidence_mode: 'live',
        binding: {
          service: input.service,
          account_ref: input.account_ref,
          project_ref: input.project_ref,
          target_binding_sha256: digest(JSON.stringify(input.target_binding)),
          ...(input.grant_ref ? { grant_ref: input.grant_ref } : {}),
        },
        token: TOKEN_CANARY,
        expires_at: new Date(Math.max(Date.now() + 60_000, deadlineAt + 60_000)).toISOString(),
        evidence: pinned('runner-credential'),
      };
      resolvedCredentials.push(resolved);
      return resolved;
    },
  };
  const { fetchImpl, requests } = interceptedFetch();
  const hostDispatches = [];
  const adapter = createOpenRouterImagesAdapter({ credentialPort: credentialResolver, fetchImpl, now: Date.now,
    dispatchPort: {
      async prepare(input) {
        if (prepareHost) return prepareHost(input, fixture);
        return { prepared_for: input.cell_id };
      },
      async dispatch(input) {
        hostDispatches.push(input);
        if (dispatchHost) return await dispatchHost(input, fixture);
        const result = await fixture.adapter.dispatch(input);
        return { ...result, evidence_mode: 'live', evidence: { ...result.evidence,
          artifact_sha256: digest('synthetic fixture artifact'), artifact_width: 1024, artifact_height: 1024 } };
      },
    } });
  const args = { ...fixture.args, mode: 'live', adapter, ...(signal ? { signal } : {}) };
  return { args, fixture, credentialCalls, resolvedCredentials, requests, hostDispatches };
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
  const hostDispatchInputs = [];
  const calls = [];
  const composed = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort({ calls }), fetchImpl, dispatchPort: {
    async prepare(input) { seen.push(['prepare', input.cell_id, input.credential.token]); return { host_prepared: input.cell_id }; },
    async dispatch(input) {
      hostDispatchInputs.push(input);
      seen.push(['dispatch', input.cell_id, input.credential.token, input.prepared, input.signal instanceof AbortSignal]);
      return { host: 'result' };
    },
  } });
  const input = billable('image_edit');
  const prepared = await composed.prepare(input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].purpose, 'authorized_billable_operation', 'billable operations resolve the authorized_billable_operation purpose');
  assert.equal(calls[0].grant_ref, GRANT);
  assert.ok(!JSON.stringify(prepared).includes(TOKEN_CANARY), 'the credential is not in the value the runner holds');
  assert.deepEqual(await composed.dispatch(dispatchInput(input, prepared)), { host: 'result' });
  assert.deepEqual(seen, [['prepare', 'image_edit', TOKEN_CANARY], ['dispatch', 'image_edit', TOKEN_CANARY, { host_prepared: 'image_edit' }, true]]);
  assert.equal(hostDispatchInputs[0].configuration, hostDispatchInputs[0].target.configuration);
  assert.ok(Object.isFrozen(hostDispatchInputs[0].configuration), 'host dispatch receives the frozen authenticated configuration');
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
    ['different target contents', { ...ok, prepared: okPrepared, target: { ...target('image_generation'), model: 'synthetic-lab/other-image' } }],
    ['configuration differs from target pin', { ...ok, prepared: okPrepared, configuration: { ...ok.configuration, provider_tag: 'other-provider' } }],
    ['mismatched pin', { ...ok, prepared: okPrepared, target: wrong.target }],
  ]) await assert.rejects(composed.dispatch({ ...bad, metering: meteringInput() }),
    (error) => ['credential_unavailable', 'unsupported_image_configuration'].includes(error.code), name);
  assert.equal(seen.filter(([kind]) => kind === 'dispatch').length, 1, 'no rejected dispatch reached the host port');
  assert.equal(seen.length, before + 1, 'only the one valid prepare ran after the rejections');

  const structurallyEqual = billable('image_generation');
  const structurallyEqualPrepared = await composed.prepare(structurallyEqual);
  assert.deepEqual(await composed.dispatch(dispatchInput({ ...structurallyEqual,
    target: structuredClone(structurallyEqual.target) }, structurallyEqualPrepared)), { host: 'result' },
  'a separately allocated but content-identical target retains the exact pinned binding');
  assert.equal(hostDispatchInputs[1].configuration, hostDispatchInputs[1].target.configuration);
  assert.ok(Object.isFrozen(hostDispatchInputs[1].configuration));
  assert.equal(seen.filter(([kind]) => kind === 'dispatch').length, 2);
  assert.equal(seen.length, before + 3, 'the structural-copy case reaches host prepare and dispatch once');
  assert.equal(requests.length, 0, 'the metadata adapter never sends a paid request');
  // A port without prepare still gets a credential-bound prepare step.
  const noPrepare = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl, dispatchPort: {
    async dispatch(input) { return { token_seen: input.credential.token === TOKEN_CANARY, prepared: input.prepared }; } } });
  assert.deepEqual(await noPrepare.dispatch(dispatchInput(ok, await noPrepare.prepare(ok))), { token_seen: true, prepared: undefined });
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
  await assert.rejects(late.dispatch(dispatchInput(input, prepared)), (error) => error.code === 'preflight_deadline_passed');
  assert.deepEqual(hostCalls, ['prepare', 'prepare']);
});

test('billable dispatch requires a native runner signal and combines it with the bounded deadline', async () => {
  const { fetchImpl } = interceptedFetch();
  const hostSignals = [];
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl,
    dispatchPort: { async dispatch(input) { hostSignals.push(input.signal); return { host: 'result' }; } } });
  const input = billable();
  const prepared = await adapter.prepare(input);

  const getterSignal = {};
  Object.defineProperty(getterSignal, 'aborted', { get() { throw new Error(TOKEN_CANARY); } });
  const proxySignal = new Proxy({}, { getPrototypeOf() { throw new Error(TOKEN_CANARY); } });
  const spoofedSignal = Object.create(AbortSignal.prototype);
  assert.equal(spoofedSignal instanceof AbortSignal, true, 'prototype spoof defeats instanceof alone');
  for (const signal of [undefined, null, {}, { aborted: false }, getterSignal, proxySignal, spoofedSignal]) {
    await assert.rejects(adapter.dispatch({ ...input, prepared, metering: { signal } }),
      (error) => error.code === 'invalid_abort_signal' && !error.message.includes(TOKEN_CANARY));
  }
  const hostileContext = { ...input, prepared };
  Object.defineProperty(hostileContext, 'metering', { get() { throw new Error(TOKEN_CANARY); } });
  await assert.rejects(adapter.dispatch(hostileContext),
    (error) => error.code === 'invalid_abort_signal' && !error.message.includes(TOKEN_CANARY));
  const preCancelled = new AbortController();
  preCancelled.abort();
  await assert.rejects(adapter.dispatch(dispatchInput(input, prepared, preCancelled.signal)),
    (error) => error.code === 'preflight_deadline_passed');
  assert.deepEqual(hostSignals, [], 'invalid or missing caller signals never reach the host');

  const caller = new AbortController();
  assert.deepEqual(await adapter.dispatch(dispatchInput(input, prepared, caller.signal)), { host: 'result' });
  assert.equal(hostSignals.length, 1);
  assert.ok(hostSignals[0] instanceof AbortSignal);
  assert.notEqual(hostSignals[0], caller.signal, 'the host receives the combined signal');
  caller.abort();
  assert.equal(hostSignals[0].aborted, true, 'runner cancellation reaches the host signal');

  const proxiedCaller = new AbortController();
  const proxiedSignal = new Proxy(proxiedCaller.signal, {});
  const proxiedPrepared = await adapter.prepare(input);
  await assert.rejects(adapter.dispatch(dispatchInput(input, proxiedPrepared, proxiedSignal)),
    (error) => error.code === 'invalid_abort_signal', 'Proxy signals are explicitly unsupported at the JS trust boundary');
  assert.equal(hostSignals.length, 1, 'even a forwarding proxy is refused before host dispatch');
});

test('native cancellation state wins over a shadowed aborted property before host dispatch', async () => {
  const hostSignals = [];
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl,
    dispatchPort: { async dispatch(input) { hostSignals.push(input.signal); return { host: 'result' }; } } });
  const input = billable();
  const cancelledPrepared = await adapter.prepare(input);
  const cancelled = new AbortController();
  cancelled.abort();
  Object.defineProperty(cancelled.signal, 'aborted', { value: false });
  const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
  assert.equal(cancelled.signal.aborted, false, 'the caller-visible property is shadowed');
  assert.equal(nativeAborted.call(cancelled.signal), true, 'the native cancellation slot remains set');
  await assert.rejects(adapter.dispatch(dispatchInput(input, cancelledPrepared, cancelled.signal)),
    (error) => error.code === 'preflight_deadline_passed');
  assert.deepEqual(hostSignals, [], 'a shadowed pre-cancelled native signal never reaches the host');

  const active = new AbortController();
  Object.defineProperty(active.signal, 'aborted', { value: false });
  assert.equal(nativeAborted.call(active.signal), false, 'the native active state is preserved with an own property');
  const activePrepared = await adapter.prepare(input);
  assert.deepEqual(await adapter.dispatch(dispatchInput(input, activePrepared, active.signal)), { host: 'result' });
  assert.equal(hostSignals.length, 1, 'an active native signal with the same own-property shadow remains dispatchable');
  active.abort();
  assert.equal(nativeAborted.call(hostSignals[0]), true, 'the composed native signal still observes later caller cancellation');
});

test('dispatch rechecks the native cancellation slot after signal composition', async () => {
  const caller = new AbortController();
  let cancelDuringClockRead = false;
  const hostSignals = [];
  const adapter = createOpenRouterImagesAdapter({ now: () => {
    if (cancelDuringClockRead) {
      cancelDuringClockRead = false;
      caller.abort();
    }
    return clock();
  }, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl,
  dispatchPort: { async dispatch(input) { hostSignals.push(input.signal); return { host: 'result' }; } } });
  const input = billable();
  const prepared = await adapter.prepare(input);
  Object.defineProperty(caller.signal, 'aborted', { value: false });
  const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
  assert.equal(nativeAborted.call(caller.signal), false);
  cancelDuringClockRead = true;
  await assert.rejects(adapter.dispatch(dispatchInput(input, prepared, caller.signal)),
    (error) => error.code === 'preflight_deadline_passed');
  assert.equal(nativeAborted.call(caller.signal), true, 'the native signal aborts after the pre-composition check');
  assert.deepEqual(hostSignals, [], 'cancellation during signal construction stops dispatch before the host');
});

test('prepare rechecks finite clock and deadline after credential and host preparation awaits', async () => {
  const { fetchImpl } = interceptedFetch();
  const hostCalls = [];
  const dispatchPort = {
    async prepare() { hostCalls.push('prepare'); return { host_prepared: true }; },
    async dispatch() { hostCalls.push('dispatch'); return {}; },
  };

  nowMs = Date.parse('2031-03-04T05:06:07.000Z');
  const invalidAfterCredential = createOpenRouterImagesAdapter({ now: clock, fetchImpl, dispatchPort,
    credentialPort: grantCredentialPort({ mutate(value) { nowMs = NaN; return value; } }) });
  await assert.rejects(invalidAfterCredential.prepare(billable()), (error) => error.code === 'adapter_unavailable');
  assert.deepEqual(hostCalls, [], 'a non-finite clock after credential resolution never reaches host preparation');

  nowMs = Date.parse('2031-03-04T05:06:07.000Z');
  const expiredWhileResolving = createOpenRouterImagesAdapter({ now: clock, fetchImpl, dispatchPort,
    credentialPort: grantCredentialPort({ mutate(value) { nowMs += 500; return value; } }) });
  await assert.rejects(expiredWhileResolving.prepare(billable('image_generation', { deadline_at: deadline(100) })),
    (error) => error.code === 'preflight_deadline_passed');
  assert.deepEqual(hostCalls, [], 'a deadline that passes during credential resolution never reaches host preparation');

  nowMs = Date.parse('2031-03-04T05:06:07.000Z');
  const hostCrossesDeadline = createOpenRouterImagesAdapter({ now: clock, fetchImpl, credentialPort: grantCredentialPort(),
    dispatchPort: { async prepare() { hostCalls.push('prepare'); nowMs += 500; return { host_prepared: true }; },
      async dispatch() { hostCalls.push('dispatch'); return {}; } } });
  const hostDeadline = deadline(100);
  const hostInput = billable('image_generation', { deadline_at: hostDeadline });
  await assert.rejects(hostCrossesDeadline.prepare(hostInput), (error) => error.code === 'preflight_deadline_passed');
  assert.deepEqual(hostCalls, ['prepare'], 'the adapter does not mint dispatch authority after an awaited host preparation crosses the deadline');
  await assert.rejects(hostCrossesDeadline.dispatch(dispatchInput(hostInput, { prepared: true })),
    (error) => error.code === 'credential_unavailable');
  assert.deepEqual(hostCalls, ['prepare'], 'a rejected preparation never reaches host dispatch');

  for (const failingClock of [() => NaN, () => { throw new Error(TOKEN_CANARY); }]) {
    let hostPrepared = false;
    const invalidAfterHostPrepare = createOpenRouterImagesAdapter({ now() {
      if (hostPrepared) return failingClock();
      return Date.parse('2031-03-04T05:06:07.000Z');
    }, fetchImpl, credentialPort: grantCredentialPort(), dispatchPort: {
      async prepare() { hostPrepared = true; return { host_prepared: true }; },
      async dispatch() { hostCalls.push('dispatch'); return {}; },
    } });
    await assert.rejects(invalidAfterHostPrepare.prepare(billable()),
      (error) => error.code === 'adapter_unavailable' && !error.message.includes(TOKEN_CANARY));
    assert.equal(hostPrepared, true);
    assert.deepEqual(hostCalls, ['prepare'], 'a non-finite or throwing clock after host preparation does not mint dispatch authority');
  }

  nowMs = Date.parse('2031-03-04T05:06:07.000Z');
  for (const failingClock of [() => NaN, () => { throw new Error(TOKEN_CANARY); }]) {
    let failBeforeDispatch = false;
    const preDispatchHostCalls = [];
    const invalidBeforeDispatch = createOpenRouterImagesAdapter({ now() {
      return failBeforeDispatch ? failingClock() : Date.parse('2031-03-04T05:06:07.000Z');
    }, fetchImpl, credentialPort: grantCredentialPort(), dispatchPort: {
      async prepare() { preDispatchHostCalls.push('prepare'); return { host_prepared: true }; },
      async dispatch() { preDispatchHostCalls.push('dispatch'); return {}; },
    } });
    const invalidClockInput = billable();
    const invalidClockPrepared = await invalidBeforeDispatch.prepare(invalidClockInput);
    failBeforeDispatch = true;
    await assert.rejects(invalidBeforeDispatch.dispatch(dispatchInput(invalidClockInput, invalidClockPrepared)),
      (error) => error.code === 'adapter_unavailable' && !error.message.includes(TOKEN_CANARY));
    assert.deepEqual(preDispatchHostCalls, ['prepare'], 'a non-finite or throwing pre-dispatch clock blocks host transport');
  }
  nowMs = Date.parse('2031-03-04T05:06:07.000Z');
});

test('synthetic live runner stops pre-cancelled and prepare-time-cancelled operations before reservation', async () => {
  const beforeController = new AbortController();
  beforeController.abort();
  const before = createLiveOpenRouterRunner({ signal: beforeController.signal });
  const beforeResult = await executeAuthorizedAccessCell(before.args);
  assert.equal(beforeResult.status, 'failed');
  assert.equal(beforeResult.financial_hold, 'none');
  assert.equal(before.fixture.calls.reserve, 0);
  assert.equal(before.hostDispatches.length, 0);

  const controller = new AbortController();
  const started = deferred();
  const release = deferred();
  const during = createLiveOpenRouterRunner({ signal: controller.signal,
    async prepareHost() { started.resolve(); await release.promise; return { prepared_after_wait: true }; } });
  const pending = executeAuthorizedAccessCell(during.args);
  await started.promise;
  controller.abort();
  release.resolve();
  const duringResult = await pending;
  assert.equal(duringResult.status, 'failed');
  assert.equal(duringResult.financial_hold, 'none');
  assert.equal(during.fixture.calls.reserve, 0, 'runner cancellation during host preparation is checked before reservation');
  assert.equal(during.hostDispatches.length, 0, 'cancelled preparation never reaches billable host dispatch');
});

test('public runner preserves pre-cancellation hidden by an own aborted value or getter', async () => {
  const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
  for (const shadow of [
    (signal) => Object.defineProperty(signal, 'aborted', { value: false }),
    (signal) => Object.defineProperty(signal, 'aborted', { get() { return false; } }),
  ]) {
    const controller = new AbortController();
    controller.abort();
    shadow(controller.signal);
    assert.equal(controller.signal.aborted, false);
    assert.equal(nativeAborted.call(controller.signal), true);

    const run = createLiveOpenRouterRunner({ signal: controller.signal });
    const result = await executeAuthorizedAccessCell(run.args);

    assert.equal(result.status, 'failed');
    assert.equal(result.reason_code, 'preflight_deadline_passed');
    assert.equal(result.financial_hold, 'none');
    assert.equal(run.fixture.calls.reserve, 0);
    assert.equal(run.hostDispatches.length, 0);
    assert.equal(run.requests.length, 0, 'pre-cancellation stops before adapter inspection or credential resolution');
  }
});

test('public runner snapshots the signal property once before asynchronous work', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  Object.defineProperty(cancelled.signal, 'aborted', { value: false });
  const active = new AbortController();
  const run = createLiveOpenRouterRunner();
  let reads = 0;
  Object.defineProperty(run.args, 'signal', {
    configurable: true,
    get() {
      reads += 1;
      return reads === 1 ? cancelled.signal : active.signal;
    },
  });

  const result = await executeAuthorizedAccessCell(run.args);

  assert.equal(reads, 1);
  assert.equal(result.status, 'failed');
  assert.equal(result.reason_code, 'preflight_deadline_passed');
  assert.equal(result.financial_hold, 'none');
  assert.equal(run.fixture.calls.reserve, 0);
  assert.equal(run.hostDispatches.length, 0);
});

test('public runner rejects spoofed and throwing caller signals with sanitized failures', async () => {
  const spoofed = Object.create(AbortSignal.prototype);
  const invalid = createLiveOpenRouterRunner({ signal: spoofed });
  const invalidResult = await executeAuthorizedAccessCell(invalid.args);
  assert.equal(invalidResult.status, 'blocked');
  assert.equal(invalidResult.reason_code, 'invalid_abort_signal');
  assert.equal(invalidResult.financial_hold, 'none');
  assert.equal(invalid.fixture.calls.reserve, 0);
  assert.equal(invalid.hostDispatches.length, 0);
  assert.ok(!JSON.stringify(invalidResult).includes(TOKEN_CANARY));

  const throwing = createLiveOpenRouterRunner();
  Object.defineProperty(throwing.args, 'signal', { get() { throw new Error(TOKEN_CANARY); } });
  const throwingResult = await executeAuthorizedAccessCell(throwing.args);
  assert.equal(throwingResult.status, 'blocked');
  assert.equal(throwingResult.reason_code, 'invalid_abort_signal');
  assert.equal(throwingResult.financial_hold, 'none');
  assert.equal(throwing.fixture.calls.reserve, 0);
  assert.equal(throwing.hostDispatches.length, 0);
  assert.ok(!JSON.stringify(throwingResult).includes(TOKEN_CANARY));
});

test('public runner accepts active shadowed native signals and propagates later cancellation', async () => {
  const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
  const variants = [
    (signal) => signal,
    (signal) => {
      Object.defineProperty(signal, 'aborted', { value: false });
      return signal;
    },
    (signal) => {
      Object.defineProperty(signal, 'aborted', { get() { return false; } });
      return signal;
    },
  ];
  for (const wrap of variants) {
    const controller = new AbortController();
    const run = createLiveOpenRouterRunner({ signal: wrap(controller.signal) });
    const result = await executeAuthorizedAccessCell(run.args);

    assert.equal(result.status, 'verified');
    assert.equal(result.financial_hold, 'settled');
    assert.equal(run.fixture.calls.reserve, 1);
    assert.equal(run.hostDispatches.length, 1);
    assert.ok(run.hostDispatches[0].signal instanceof AbortSignal);
    controller.abort();
    assert.equal(nativeAborted.call(run.hostDispatches[0].signal), true);
  }
});

test('public runner catches cancellation triggered by signal composition or its clock callback', async () => {
  const compositionController = new AbortController();
  let abortedGetterReads = 0;
  Object.defineProperty(compositionController.signal, 'aborted', {
    get() {
      abortedGetterReads += 1;
      if (abortedGetterReads === 1) compositionController.abort();
      return false;
    },
  });
  const composition = createLiveOpenRouterRunner({ signal: compositionController.signal });
  const compositionResult = await executeAuthorizedAccessCell(composition.args);
  assert.ok(abortedGetterReads > 0, 'AbortSignal.any reads the callback-capable own property');
  assert.equal(Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get.call(compositionController.signal), true);
  assert.equal(compositionResult.status, 'failed');
  assert.equal(compositionResult.reason_code, 'preflight_deadline_passed');
  assert.equal(compositionResult.financial_hold, 'none');
  assert.equal(composition.fixture.calls.reserve, 0);
  assert.equal(composition.hostDispatches.length, 0);

  const clockController = new AbortController();
  Object.defineProperty(clockController.signal, 'aborted', { value: false });
  let clockArmed = false;
  let clockAbortCalls = 0;
  const nativeNow = Date.now;
  const clock = createLiveOpenRouterRunner({ signal: clockController.signal, async prepareHost() {
    clockArmed = true;
    return { prepared_before_clock: true };
  } });
  let clockResult;
  Date.now = () => {
    if (clockArmed) {
      clockArmed = false;
      clockAbortCalls += 1;
      clockController.abort();
    }
    return nativeNow();
  };
  try {
    clockResult = await executeAuthorizedAccessCell(clock.args);
  } finally {
    Date.now = nativeNow;
  }
  assert.equal(clockAbortCalls, 1);
  assert.equal(clockResult.status, 'failed');
  assert.equal(clockResult.reason_code, 'preflight_deadline_passed');
  assert.equal(clockResult.financial_hold, 'none');
  assert.equal(clock.fixture.calls.reserve, 0);
  assert.equal(clock.hostDispatches.length, 0);
});

test('public runner catches hidden native cancellation after awaited host preparation', async () => {
  const controller = new AbortController();
  Object.defineProperty(controller.signal, 'aborted', { value: false });
  const run = createLiveOpenRouterRunner({ signal: controller.signal, async prepareHost() {
    await Promise.resolve();
    controller.abort();
    return { prepared_before_cancellation_check: true };
  } });

  const result = await executeAuthorizedAccessCell(run.args);

  assert.equal(result.status, 'failed');
  assert.equal(result.reason_code, 'preflight_deadline_passed');
  assert.equal(result.financial_hold, 'none');
  assert.equal(run.fixture.calls.reserve, 0);
  assert.equal(run.hostDispatches.length, 0);
});

test('synthetic live runner preserves the final synchronous fence when cancellation arrives before transport', async () => {
  const controller = new AbortController();
  let transportStarted = false;
  const run = createLiveOpenRouterRunner({ signal: controller.signal,
    async dispatchHost(input) {
      await input.metering.recordTransportAttempt('test:openrouter-presend-cancel');
      await input.metering.authorizeTransport();
      controller.abort();
      input.metering.assertTransportReady();
      transportStarted = true;
      return { provider_outcome: 'succeeded' };
    } });
  const result = await executeAuthorizedAccessCell(run.args);
  assert.equal(transportStarted, false);
  assert.equal(result.status, 'unknown');
  assert.equal(result.verified, false);
  assert.equal(result.financial_hold, 'retained_for_reconciliation');
  assert.equal(run.fixture.calls.settle, 0);
  assert.equal(run.fixture.authority.reservationFor(run.fixture.meteringRequest.billable_attempt_id).state, 'held_for_reconciliation');
});

test('synthetic live runner propagates in-flight cancellation to host and retains unknown hold without publication', async () => {
  const controller = new AbortController();
  const entered = deferred();
  const abortObserved = deferred();
  const run = createLiveOpenRouterRunner({ signal: controller.signal,
    async dispatchHost(input) {
      await input.metering.recordTransportAttempt('test:openrouter-inflight-cancel');
      await input.metering.authorizeTransport();
      input.metering.assertTransportReady();
      assert.ok(input.signal instanceof AbortSignal);
      entered.resolve(input.signal);
      return new Promise((resolve) => {
        const finish = () => {
          abortObserved.resolve();
          resolve({ provider_outcome: 'unknown' });
        };
        if (input.signal.aborted) finish();
        else input.signal.addEventListener('abort', finish, { once: true });
      });
    } });
  const pending = executeAuthorizedAccessCell(run.args);
  const hostSignal = await entered.promise;
  controller.abort();
  await abortObserved.promise;
  const result = await pending;
  assert.equal(hostSignal.aborted, true, 'the host transport signal observes runner cancellation');
  assert.equal(result.status, 'unknown');
  assert.equal(result.verified, false);
  assert.equal(result.financial_hold, 'retained_for_reconciliation');
  assert.equal(result.operation_evidence, null, 'cancelled work is not published as provider evidence');
  assert.equal(run.fixture.calls.settle, 0);
  assert.equal(run.fixture.authority.reservationFor(run.fixture.meteringRequest.billable_attempt_id).state, 'held_for_reconciliation');
});

test('synthetic live runner bounds an in-flight host signal by the operation deadline', async () => {
  const entered = deferred();
  const abortObserved = deferred();
  const run = createLiveOpenRouterRunner({ deadlineOffsetMs: 3_000,
    async dispatchHost(input) {
      await input.metering.recordTransportAttempt('test:openrouter-deadline-cancel');
      await input.metering.authorizeTransport();
      input.metering.assertTransportReady();
      assert.ok(input.signal instanceof AbortSignal);
      entered.resolve(input.signal);
      return new Promise((resolve) => {
        const finish = () => {
          abortObserved.resolve();
          resolve({ provider_outcome: 'unknown' });
        };
        if (input.signal.aborted) finish();
        else input.signal.addEventListener('abort', finish, { once: true });
      });
    } });
  const pending = executeAuthorizedAccessCell(run.args);
  const hostSignal = await entered.promise;
  const keepAlive = setTimeout(() => {}, 4_000);
  await abortObserved.promise;
  const result = await pending;
  clearTimeout(keepAlive);
  assert.equal(hostSignal.aborted, true, 'the host transport signal aborts at the approved deadline');
  assert.equal(result.status, 'unknown');
  assert.equal(result.verified, false);
  assert.equal(result.financial_hold, 'retained_for_reconciliation');
  assert.equal(run.fixture.calls.settle, 0);
  assert.equal(run.fixture.authority.reservationFor(run.fixture.meteringRequest.billable_attempt_id).state, 'held_for_reconciliation');
});

test('synthetic live runner accepts exact bound credential and completes a valid operation', async () => {
  const run = createLiveOpenRouterRunner();
  const result = await executeAuthorizedAccessCell(run.args);
  assert.equal(result.status, 'verified', JSON.stringify(result));
  assert.equal(result.financial_hold, 'settled');
  assert.equal(run.fixture.calls.settle, 1);
  assert.equal(run.hostDispatches.length, 1);
  assert.equal(run.requests.length, 2, 'only the two in-memory non-billable metadata reads occur');

  const billableInput = run.credentialCalls.find((call) => call.purpose === 'authorized_billable_operation');
  assert.ok(billableInput);
  assert.equal(billableInput.service, 'openrouter');
  assert.equal(billableInput.account_ref, fixtureScope.account_ref);
  assert.equal(billableInput.project_ref, fixtureScope.project_ref);
  assert.equal(billableInput.grant_ref, run.args.grantRef);
  assert.deepEqual(billableInput.target_binding, {
    service: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/images',
    model: OPENROUTER_FIXTURE_MODEL,
    sdk_name: 'native-fetch',
    sdk_version: process.versions.node,
    configuration_sha256: run.fixture.target.configuration_sha256,
    account_ref: fixtureScope.account_ref,
    project_ref: fixtureScope.project_ref,
  });
  const resolved = run.resolvedCredentials[run.credentialCalls.indexOf(billableInput)];
  assert.equal(resolved.binding.target_binding_sha256, digest(JSON.stringify(billableInput.target_binding)));
  assert.equal(resolved.binding.grant_ref, run.args.grantRef);
  assert.ok(Date.parse(resolved.expires_at) >= Date.parse(run.fixture.cell.spend.deadline_at));
  assert.equal(run.hostDispatches[0].credential.token, TOKEN_CANARY);
  assert.ok(run.hostDispatches[0].signal instanceof AbortSignal);
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
    await assert.rejects(adapter.dispatch(dispatchInput(input, prepared)), (error) => error.code === 'adapter_unavailable', `dispatch ${String(bad)}`);
    await assert.rejects(inspect(adapter), (error) => error.code === 'adapter_unavailable', `inspect ${String(bad)}`);
    assert.deepEqual(hostCalls, ['prepare'], 'only the prepare made while the clock was valid reached the host');
    assert.equal(requests.length, 0, 'inspect sent no metadata request');
  }
});

test('the host dispatch signal combines a required runner cancellation signal with the deadline timeout', async () => {
  const seen = [];
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch(input) { seen.push(input.signal); return {}; } } });
  const input = billable();
  const caller = new AbortController();
  await adapter.dispatch({ ...input, prepared: await adapter.prepare(input), metering: { signal: caller.signal } });
  assert.equal(seen[0].aborted, false);
  caller.abort();
  assert.equal(seen[0].aborted, true, 'aborting the caller signal aborts the host-facing signal');
  await assert.rejects(adapter.dispatch({ ...input, prepared: await adapter.prepare(input) }),
    (error) => error.code === 'invalid_abort_signal');
  await assert.rejects(adapter.dispatch({ ...input, prepared: await adapter.prepare(input), metering: { signal: {} } }),
    (error) => error.code === 'invalid_abort_signal');
  assert.equal(seen.length, 1, 'missing and invalid caller signals never reach the host');
  const short = billable('image_generation', { deadline_at: new Date(clock() + 5).toISOString() });
  await adapter.dispatch({ ...short, prepared: await adapter.prepare(short), metering: { signal: new AbortController().signal } });
  const keepAlive = setTimeout(() => {}, 5_000);
  await new Promise((resolve) => seen[1].addEventListener('abort', resolve, { once: true }));
  clearTimeout(keepAlive);
  assert.equal(seen[1].aborted, true, 'the host-facing signal aborts at the approved deadline');
});

test('a prepared value is single use and bound to the scope it was prepared for', async () => {
  let dispatches = 0;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch() { dispatches += 1; return {}; } } });
  const input = billable();
  input.scope = { ...input.scope };
  const prepared = await adapter.prepare(input);
  await assert.rejects(adapter.dispatch(dispatchInput({ ...input, scope: { ...input.scope, project_ref: 'project:other' } }, prepared)),
    (error) => error.code === 'credential_unavailable');
  assert.equal(dispatches, 0, 'a scope mismatch never reaches the host and does not consume the value');
  input.scope.project_ref = 'project:other';
  await assert.rejects(adapter.dispatch(dispatchInput(input, prepared)), (error) => error.code === 'credential_unavailable');
  input.scope.project_ref = fixtureScope.project_ref;
  await adapter.dispatch(dispatchInput(input, prepared));
  await assert.rejects(adapter.dispatch(dispatchInput(input, prepared)), (error) => error.code === 'credential_unavailable');
  assert.equal(dispatches, 1, 'the replay was refused before the host port');
});

test('a metering signal getter cannot replace the prepared identity before single-use consumption', async () => {
  let dispatches = 0;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch() { dispatches += 1; return {}; } } });
  const input = billable();
  const prepared = await adapter.prepare(input);
  const callerSignal = new AbortController().signal;
  let payload;
  payload = { ...input, prepared, metering: { get signal() {
    payload.prepared = { prepared: true };
    return callerSignal;
  } } };

  await adapter.dispatch(payload);
  assert.equal(dispatches, 1, 'the authenticated prepared value reaches the host once');
  await assert.rejects(adapter.dispatch(dispatchInput(input, prepared)), (error) => error.code === 'credential_unavailable');
  await assert.rejects(adapter.dispatch(payload), (error) => error.code === 'credential_unavailable');
  assert.equal(dispatches, 1, 'neither the consumed value nor its caller-supplied replacement can replay host dispatch');
});

test('a prepared getter changing across reads cannot retain the authenticated identity', async () => {
  let dispatches = 0;
  let preparedReads = 0;
  let hostPrepared;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch(args) { dispatches += 1; hostPrepared = args.prepared; return {}; } } });
  const input = billable();
  const prepared = await adapter.prepare(input);
  const payload = { ...input, metering: meteringInput() };
  Object.defineProperty(payload, 'prepared', { enumerable: true, get() {
    preparedReads += 1;
    return preparedReads === 1 ? prepared : { prepared: true };
  } });

  await adapter.dispatch(payload);
  assert.equal(preparedReads, 1, 'the caller-owned prepared getter is read once into the dispatch snapshot');
  assert.equal(hostPrepared, undefined, 'the adapter passes only the host preparation result, not the caller identity');
  await assert.rejects(adapter.dispatch(dispatchInput(input, prepared)), (error) => error.code === 'credential_unavailable');
  assert.equal(dispatches, 1, 'the captured authenticated identity is consumed once despite later getter values');
});

test('reentrant signal access allows exactly one dispatch of a prepared value', async () => {
  let dispatches = 0;
  let enteredSignalGetter = false;
  let reentrantDispatch;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch() { dispatches += 1; return { host: 'result' }; } } });
  const input = billable();
  const prepared = await adapter.prepare(input);
  let payload;
  payload = { ...input, prepared, metering: { get signal() {
    if (!enteredSignalGetter) {
      enteredSignalGetter = true;
      reentrantDispatch = adapter.dispatch(payload);
    }
    return new AbortController().signal;
  } } };

  await assert.rejects(adapter.dispatch(payload), (error) => error.code === 'credential_unavailable');
  assert.deepEqual(await reentrantDispatch, { host: 'result' });
  assert.equal(dispatches, 1, 'the inner dispatch consumes the identity and the outer dispatch cannot also reach the host');
  await assert.rejects(adapter.dispatch(dispatchInput(input, prepared)), (error) => error.code === 'credential_unavailable');
  assert.equal(dispatches, 1, 'the prepared value remains consumed after reentrant access');
});

test('prepare re-checks the deadline after the credential await and never calls the host prepare once it has passed', async () => {
  for (const [name, phase, change, code] of [
    ['deadline passes after resolution', 'after', (r) => r + 200_000, 'preflight_deadline_passed'],
    ['clock fault during resolution fails closed as adapter unavailable', 'before', () => NaN, 'adapter_unavailable']]) {
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

test('prepare stores and forwards a frozen copy of the full trusted scope', async () => {
  let dispatches = 0;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async prepare(hostInput) {
      assert.deepEqual(hostInput.scope, fixtureScope);
      assert.ok(Object.isFrozen(hostInput.scope));
      return {};
    },
    async dispatch(hostInput) {
      dispatches += 1;
      assert.deepEqual(hostInput.scope, fixtureScope);
      assert.ok(Object.isFrozen(hostInput.scope));
      return {};
    } } });
  for (const field of ['tenant_id', 'project_id', 'budget_scope_id', 'account_ref', 'project_ref']) {
    const dispatchesBeforeCase = dispatches;
    const input = billable();
    const expectedScope = { ...input.scope };
    const callerScope = { ...input.scope };
    const prepared = await adapter.prepare({ ...input, scope: callerScope });
    callerScope[field] = `test:changed-${field}`;
    await assert.rejects(adapter.dispatch(dispatchInput({ ...input, scope: callerScope }, prepared)),
      (error) => error.code === 'credential_unavailable', `${field} mutation is rejected before host dispatch`);
    assert.equal(dispatches, dispatchesBeforeCase, `${field} mismatch does not consume the prepared value`);
    await adapter.dispatch(dispatchInput({ ...input, scope: expectedScope }, prepared));
    assert.equal(dispatches, dispatchesBeforeCase + 1, `${field} can be restored to the authenticated scope and dispatched once`);
  }
});

test('prepare rejects each binding mutation during credential and host awaits, with unchanged positive controls', async () => {
  nowMs = Date.parse('2031-03-04T05:06:07.000Z');
  const mutations = [
    ['tenant_id', (input) => { input.scope.tenant_id = 'tenant:changed'; }],
    ['project_id', (input) => { input.scope.project_id = 'project:changed'; }],
    ['budget_scope_id', (input) => { input.scope.budget_scope_id = 'budget:changed'; }],
    ['account_ref', (input) => { input.scope.account_ref = 'account:changed'; }],
    ['project_ref', (input) => { input.scope.project_ref = 'project:changed'; }],
    ['target contents', (input) => { input.target.model = 'synthetic-lab/changed-image'; }],
    ['grant_ref', (input) => { input.grant_ref = 'grant:changed'; }],
    ['deadline_at', (input) => { input.deadline_at = new Date(nowMs + 240_000).toISOString(); }],
    ['configuration contents', (input) => { input.configuration.provider_tag = 'changed-provider'; }],
    ['configuration removal', (input) => { delete input.configuration; }],
    ['configuration addition', (input) => { input.configuration = structuredClone(input.target.configuration); }, true],
  ];

  const exercise = async (phase, { mutation, mutationName, omitConfiguration = false } = {}) => {
    const context = `${phase} await / ${mutationName ?? 'unchanged input'}`;
    const input = billable();
    input.scope = { ...input.scope };
    if (omitConfiguration) delete input.configuration;
    const expected = {
      scope: { ...input.scope },
      account_ref: input.scope.account_ref,
      project_ref: input.scope.project_ref,
      grant_ref: input.grant_ref,
      deadline_at: input.deadline_at,
      target: structuredClone(input.target),
      hasConfiguration: Object.hasOwn(input, 'configuration'),
    };
    const credentialEntered = deferred();
    const credentialGate = deferred();
    const credentialBase = grantCredentialPort();
    const credentialSource = {
      evidence_mode: 'live',
      resolveCredential(args) {
        credentialEntered.resolve(structuredClone(args));
        return credentialBase.resolveCredential(args).then((resolved) => credentialGate.promise.then(() => resolved));
      },
    };
    const hostEntered = deferred();
    const hostGate = deferred();
    const hostInputs = [];
    const dispatchInputs = [];
    const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialSource,
      fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
        async prepare(hostInput) {
          hostInputs.push(hostInput);
          if (phase === 'host') {
            hostEntered.resolve(hostInput);
            await hostGate.promise;
          }
          return { host_prepared: true };
        },
        async dispatch(hostInput) { dispatchInputs.push(hostInput); return { dispatched: true }; },
      } });
    const preparing = adapter.prepare(input);

    if (phase === 'credential') {
      const credentialRequest = await credentialEntered.promise;
      assert.equal(credentialRequest.account_ref, expected.account_ref);
      assert.equal(credentialRequest.project_ref, expected.project_ref);
      assert.equal(credentialRequest.grant_ref, expected.grant_ref);
      assert.equal(credentialRequest.target_binding.model, expected.target.model);
      mutation?.(input);
      credentialGate.resolve();
    } else {
      credentialGate.resolve();
      const hostInput = await hostEntered.promise;
      assert.deepEqual(hostInput.scope, expected.scope);
      assert.ok(Object.isFrozen(hostInput.scope));
      assert.equal(hostInput.scope.account_ref, expected.account_ref);
      assert.equal(hostInput.scope.project_ref, expected.project_ref);
      assert.equal(hostInput.grant_ref, expected.grant_ref);
      assert.equal(hostInput.deadline_at, expected.deadline_at);
      assert.deepEqual(hostInput.target, expected.target);
      assert.equal(Object.hasOwn(hostInput, 'configuration'), expected.hasConfiguration);
      if (expected.hasConfiguration) {
        assert.deepEqual(hostInput.configuration, expected.target.configuration);
        assert.equal(hostInput.configuration, hostInput.target.configuration);
        assert.ok(Object.isFrozen(hostInput.configuration));
      }
      mutation?.(input);
      assert.deepEqual(hostInput.scope, expected.scope, 'host preparation retains the complete frozen scope snapshot');
      assert.equal(hostInput.scope.account_ref, expected.account_ref, 'host receives a frozen scope snapshot');
      assert.equal(hostInput.target.model, expected.target.model, 'host receives a frozen target snapshot');
      if (expected.hasConfiguration) {
        assert.equal(hostInput.configuration.provider_tag, expected.target.configuration.provider_tag,
          'host configuration is the authenticated frozen target configuration');
      }
      hostGate.resolve();
    }

    if (mutation) {
      const expectedCode = mutationName === 'target contents' ? 'unsupported_image_configuration' : 'credential_unavailable';
      await assert.rejects(preparing, (error) => error.code === expectedCode, context);
      assert.equal(hostInputs.length, phase === 'credential' ? 0 : 1,
        `${context} has the expected host preparation boundary`);
      assert.equal(dispatchInputs.length, 0, `${context} never reaches host dispatch`);
      return;
    }

    const prepared = await preparing;
    assert.equal(hostInputs.length, 1);
    assert.deepEqual(hostInputs[0].scope, expected.scope);
    assert.ok(Object.isFrozen(hostInputs[0].scope));
    const dispatchPayload = { ...input, target: structuredClone(expected.target), scope: { ...input.scope }, prepared,
      metering: meteringInput() };
    if (expected.hasConfiguration) dispatchPayload.configuration = structuredClone(expected.target.configuration);
    assert.deepEqual(await adapter.dispatch(dispatchPayload), { dispatched: true });
    assert.equal(dispatchInputs.length, 1, `${context} remains dispatchable`);
    assert.deepEqual(dispatchInputs[0].scope, expected.scope);
    assert.ok(Object.isFrozen(dispatchInputs[0].scope));
    if (expected.hasConfiguration) {
      assert.equal(dispatchInputs[0].configuration, dispatchInputs[0].target.configuration,
        'dispatch receives the authenticated configuration from its frozen target snapshot');
      assert.ok(Object.isFrozen(dispatchInputs[0].configuration));
      assert.equal(dispatchInputs[0].configuration.provider_tag, expected.target.configuration.provider_tag);
    } else {
      assert.equal(Object.hasOwn(dispatchInputs[0], 'configuration'), false);
    }
  };

  for (const phase of ['credential', 'host']) {
    await exercise(phase);
    await exercise(phase, { omitConfiguration: true });
    for (const [name, mutate, omitConfiguration] of mutations) {
      await exercise(phase, { mutation: mutate, mutationName: name, omitConfiguration: Boolean(omitConfiguration) });
    }
  }
});

test('a caller scope change during host preparation invalidates the attempt and host scope stays frozen', async () => {
  let hostPreparations = 0;
  let dispatches = 0;
  let hostScope;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async prepare(args) {
      hostPreparations += 1;
      hostScope = args.scope;
      assert.ok(Object.isFrozen(args.scope), 'the host gets a frozen snapshot, not the caller object');
      assert.notEqual(args.scope, input.scope);
      assert.throws(() => { 'use strict'; args.scope.project_ref = 'project:host'; }, TypeError);
      // The caller's live object cannot change the frozen host scope, and the pending prepare is rejected afterward.
      input.scope.account_ref = 'account:host';
      input.scope.project_ref = 'project:host';
      return {};
    },
    async dispatch() { dispatches += 1; return {}; } } });
  const input = billable('image_generation', { scope: { ...fixtureScope } });
  const original = { ...fixtureScope };
  await assert.rejects(adapter.prepare(input), (error) => error.code === 'credential_unavailable');
  assert.deepEqual({ ...hostScope }, original, 'the host saw the original refs, not the mutated ones');
  assert.equal(hostPreparations, 1);
  assert.equal(dispatches, 0, 'a mutated pending scope cannot mint prepared state or reach host dispatch');
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
    async prepare(args) {
      assert.ok(Object.isFrozen(args), 'the host receives a frozen authenticated preparation snapshot');
      assert.throws(() => { 'use strict'; args.target = { ...args.target, model: 'other-author/other-model' }; }, TypeError);
      assert.throws(() => { 'use strict'; args.grant_ref = 'grant:other'; }, TypeError);
      return {};
    },
    async dispatch() { dispatches += 1; return {}; } } });
  const prepared = await adapter.prepare(input);
  await adapter.dispatch({ ...input, target: bound, prepared, metering: meteringInput() });
  assert.equal(dispatches, 1, 'a host that rewrites its own copy of the input leaves the binding on the validated target and grant');
});

test('a caller mutating input.scope while credential resolution is awaiting invalidates preparation', async () => {
  let dispatches = 0;
  let hostPreparations = 0;
  const inner = grantCredentialPort();
  const input = billable('image_generation', { scope: { ...fixtureScope } });
  const credentialSource = { evidence_mode: 'live', async resolveCredential(args) {
    const result = inner.resolveCredential(args);
    input.scope.project_ref = 'project:swapped';
    return result;
  } };
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialSource, fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async prepare() { hostPreparations += 1; return {}; }, async dispatch() { dispatches += 1; return {}; } } });
  await assert.rejects(adapter.prepare(input), (error) => error.code === 'credential_unavailable');
  assert.equal(hostPreparations, 0, 'the token resolved for the original scope is not passed to host preparation');
  assert.equal(dispatches, 0);
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

test('caller changes to grant_ref, deadline_at, or cell_id during credential resolution stop before host preparation', async () => {
  // The adapter freezes the credential binding before the resolver await. Any caller-side change while resolution
  // is pending invalidates this attempt, so a token resolved for the original inputs cannot mint reusable state.
  for (const [field, change, code] of [
    ['grant_ref', 'grant:test:other', 'credential_unavailable'],
    ['deadline_at', deadline(60_000), 'credential_unavailable'],
    ['cell_id', 'image_edit', 'unsupported_image_configuration'],
  ]) {
    let hostPreparations = 0;
    let dispatches = 0;
    const inner = grantCredentialPort();
    const input = billable();
    const credentialSource = { evidence_mode: 'live', async resolveCredential(args) {
      const result = inner.resolveCredential(args);
      input[field] = change;
      return result;
    } };
    const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: credentialSource,
      fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
        async prepare() { hostPreparations += 1; return {}; },
        async dispatch() { dispatches += 1; return {}; },
      } });
    await assert.rejects(adapter.prepare(input), (error) => error.code === code, field);
    assert.equal(hostPreparations, 0, `${field}: no host preparation after a binding changes`);
    assert.equal(dispatches, 0, `${field}: no host dispatch after a binding changes`);
  }
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

test('unread target annotations do not affect the binding, while dispatch configuration stays bound to prepare', async () => {
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
  const mismatched = { ...input, configuration: { divergent: true }, prepared, metering: meteringInput() };
  await assert.rejects(adapter.dispatch(mismatched), (error) => error.code === 'credential_unavailable',
    'configuration presence and content remain bound to the credential resolved during prepare');
  assert.equal(dispatches, 0);
  await adapter.dispatch({ ...input, configuration: structuredClone(input.target.configuration), prepared, metering: meteringInput() });
  assert.equal(dispatches, 1);
  assert.deepEqual(hostConfiguration, input.target.configuration, 'a divergent top-level configuration never reaches the host');
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

test('getters on the dispatch input that switch values after N reads never reach the host or the checks', async () => {
  const seen = [];
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch(args) { seen.push(args); return {}; } } });
  const input = billable('image_generation', { scope: { ...fixtureScope } });
  const prepared = await adapter.prepare(input);
  const evilTarget = structuredClone(input.target);
  evilTarget.model = 'evil-author/evil-model';
  const after = (count, real, evil) => { let reads = 0; return () => (++reads > count ? evil : real); };
  const din = { run_id: input.run_id, prepared, deadline_at: input.deadline_at, configuration: input.configuration };
  Object.defineProperty(din, 'cell_id', { enumerable: true, value: input.cell_id });
  Object.defineProperty(din, 'target', { enumerable: true, get: after(1, input.target, evilTarget) });
  Object.defineProperty(din, 'scope', { enumerable: true, get: after(1, input.scope, { ...input.scope, project_ref: 'project:evil' }) });
  Object.defineProperty(din, 'grant_ref', { enumerable: true, get: after(1, input.grant_ref, 'grant:evil') });
  din.metering = meteringInput();
  await adapter.dispatch(din);
  assert.equal(seen.length, 1);
  assert.notEqual(seen[0].target, input.target, 'the host gets a frozen copy, not the live object');
  assert.deepEqual(seen[0].target, input.target);
  assert.equal(seen[0].target.model, input.target.model);
  assert.equal(seen[0].scope.project_ref, input.scope.project_ref);
  assert.ok(Object.isFrozen(seen[0].scope));
  assert.equal(seen[0].grant_ref, input.grant_ref);
  // A getter that throws, or an input that is not a record, fails closed.
  const second = await adapter.prepare(input);
  await assert.rejects(adapter.dispatch({ ...input, prepared: second, get run_id() { return 1; }, get zz() { throw new Error('boom'); } }),
    (error) => error.code === 'credential_unavailable');
  await assert.rejects(adapter.dispatch(null), (error) => error.code === 'credential_unavailable');
});

const deepFrozen = (value) => value === null || typeof value !== 'object'
  || (Object.isFrozen(value) && Reflect.ownKeys(value).every((key) => deepFrozen(value[key])));
const EVIL_MODEL = 'evil-author/evil-model';

test('the host dispatch only ever sees the validated target, even when the caller flips and restores it while the host awaits', async () => {
  const seen = [];
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch(args) {
      await null;
      seen.push({ model: args.target.model, provider_tag: args.configuration.provider_tag, frozen: deepFrozen(args.target) });
      return {};
    } } });
  const input = billable();
  const model = input.target.model;
  const prepared = await adapter.prepare(input);
  const pending = adapter.dispatch({ ...input, prepared, metering: meteringInput() });
  input.target.model = EVIL_MODEL;
  input.target.configuration.provider_tag = 'evil-tag';
  await pending;
  assert.deepEqual(seen, [{ model, provider_tag: target().configuration.provider_tag, frozen: true }]);
});

test('the host prepare only ever sees the validated target while the caller flips and restores it', async () => {
  const seen = [];
  const input = billable();
  const model = input.target.model;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async prepare(args) {
      input.target.model = EVIL_MODEL;
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push({ model: args.target.model, frozen: deepFrozen(args.target) });
      input.target.model = model;
      return {};
    },
    async dispatch() { return {}; } } });
  await adapter.prepare(input);
  assert.deepEqual(seen, [{ model, frozen: true }]);
});

test('dispatch reads each enumerable input property once, and a target the host cannot be given as a copy fails closed', async () => {
  let reads = 0;
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async prepare() { throw new Error('host prepare must not run'); }, async dispatch() { return {}; } } });
  const plain = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
    async dispatch() { return {}; } } });
  const input = billable();
  const prepared = await plain.prepare(input);
  const din = { ...input, prepared };
  Object.defineProperty(din, 'zz', { enumerable: true, get() { reads += 1; return 1; } });
  din.metering = meteringInput();
  await plain.dispatch(din);
  assert.equal(reads, 1);
  const uncloneable = billable();
  uncloneable.target.hook = () => {};
  await assert.rejects(adapter.prepare(uncloneable), (error) => error.code === 'unsupported_image_configuration');
});

test('a target.model getter that answers evil on exactly the k-th read never binds or reaches the host', async () => {
  const FAIL_CLOSED = new Set(['unsupported_image_configuration', 'credential_unavailable']);
  for (let k = 1; k <= 14; k += 1) {
    const calls = [];
    const hostModels = [];
    const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort({ calls }), fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
      async prepare(args) { hostModels.push(args.target.model); return {}; },
      async dispatch(args) { hostModels.push(args.target.model); return {}; } } });
    const input = billable();
    const real = input.target.model;
    let reads = 0;
    Object.defineProperty(input.target, 'model', { enumerable: true, configurable: true, get() { reads += 1; return reads === k ? EVIL_MODEL : real; } });
    try {
      const prepared = await adapter.prepare(input);
      await adapter.dispatch({ ...input, prepared, metering: meteringInput() });
    } catch (error) {
      assert.ok(FAIL_CLOSED.has(error.code), `k=${k}: unexpected ${error.code ?? error}`);
    }
    for (const call of calls) assert.equal(call.target_binding.model, real, `k=${k}: credential binding`);
    for (const model of hostModels) assert.equal(model, real, `k=${k}: host args`);
  }
});


test('direct prepare and dispatch reject hostile signal proxies before credential or host effects', async () => {
  const calls = [];
  const host = [];
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort({ calls }),
    fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
      async prepare(args) { assert.equal(Object.hasOwn(args, 'signal'), false); host.push('prepare'); }, async dispatch() { host.push('dispatch'); } } });
  const input = billable();
  const controller = new AbortController(); controller.abort();
  let traps = 0;
  const signal = new Proxy(controller.signal, { get(target, key, receiver) {
    traps += 1;
    if (key === 'aborted' || String(key) === 'Symbol(kAborted)') return false;
    return Reflect.get(target, key, receiver);
  } });
  await assert.rejects(adapter.prepare({ ...input, signal }), (e) => e.code === 'invalid_abort_signal');
  assert.equal(calls.length, 0); assert.deepEqual(host, []); assert.equal(traps, 0);
  const prepared = await adapter.prepare(input); // Direct callers may still omit a preparation signal.
  await assert.rejects(adapter.dispatch(dispatchInput(input, prepared, signal)), (e) => e.code === 'invalid_abort_signal');
  assert.deepEqual(host, ['prepare']); assert.equal(traps, 0);
  assert.ok(calls.every((request) => !Object.hasOwn(request, 'signal')), 'credentials never receive cancellation input');
});

test('credential callback cannot rewrite its own expected target binding', async () => {
  const host = [];
  const port = grantCredentialPort();
  const resolve = port.resolveCredential.bind(port);
  port.resolveCredential = async (request) => {
    request.target_binding.model = EVIL_MODEL;
    return resolve(request);
  };
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: port, fetchImpl: interceptedFetch().fetchImpl,
    dispatchPort: { async prepare() { host.push('prepare'); }, async dispatch() { host.push('dispatch'); } } });
  await assert.rejects(adapter.prepare(billable()), (e) => e.code === 'credential_unavailable');
  assert.deepEqual(host, []);
});

test('nested authorization evidence cannot change across the credential await', async () => {
  const input = billable(); input.authorization_evidence = pinned('authorization');
  const port = grantCredentialPort(); const resolve = port.resolveCredential.bind(port); const host = [];
  port.resolveCredential = async (request) => {
    const result = await resolve(request);
    input.authorization_evidence.ref = 'test:changed';
    input.authorization_evidence.independent_review.ref = 'test:changed-review';
    return result;
  };
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: port, fetchImpl: interceptedFetch().fetchImpl,
    dispatchPort: { async prepare(args) { host.push(args); }, async dispatch() {} } });
  await assert.rejects(adapter.prepare(input), (e) => e.code === 'credential_unavailable');
  assert.deepEqual(host, []);
});

test('host receives frozen authorization evidence bound at preparation', async () => {
  const input = billable(); input.authorization_evidence = pinned('authorization');
  const expected = structuredClone(input.authorization_evidence); const host = [];
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl,
    dispatchPort: { async prepare(args) { host.push(args.authorization_evidence); },
      async dispatch(args) { host.push(args.authorization_evidence); } } });
  const prepared = await adapter.prepare(input);
  await adapter.dispatch(dispatchInput(input, prepared));
  assert.equal(host.length, 2);
  for (const evidence of host) {
    assert.deepEqual(evidence, expected); assert.notEqual(evidence, input.authorization_evidence);
    assert.ok(Object.isFrozen(evidence)); assert.ok(Object.isFrozen(evidence.independent_review));
  }
});

test('a clock callback changing the target stops before host preparation', async () => {
  const input = billable(); const host = []; let reads = 0;
  const adapter = createOpenRouterImagesAdapter({ now() {
    reads += 1; if (reads === 4) input.target.model = EVIL_MODEL; return clock();
  }, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl,
  dispatchPort: { async prepare() { host.push('prepare'); }, async dispatch() { host.push('dispatch'); } } });
  await assert.rejects(adapter.prepare(input), (e) => e.code === 'unsupported_image_configuration');
  assert.deepEqual(host, []);
});

test('preparation cancellation at every async and clock boundary stops later host effects', async () => {
  for (const boundary of ['already', 'credential', 'clock-before-host', 'host-prepare']) {
    const controller = new AbortController(); const calls = []; const host = []; let reads = 0; let lateHostReads = 0;
    const port = grantCredentialPort({ calls }); const resolve = port.resolveCredential.bind(port);
    port.resolveCredential = async (request) => { const result = await resolve(request);
      if (boundary === 'credential') controller.abort(); return result; };
    const adapter = createOpenRouterImagesAdapter({ now() {
      reads += 1; if (reads === 4 && boundary === 'clock-before-host') controller.abort(); return clock();
    }, credentialPort: port, fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
      get prepare() {
        if (controller.signal.aborted) lateHostReads += 1;
        return async (args) => {
          assert.equal(Object.hasOwn(args, 'signal'), false);
          host.push('prepare'); if (boundary === 'host-prepare') controller.abort();
        };
      },
      async dispatch() { host.push('dispatch'); } } });
    if (boundary === 'already') controller.abort();
    await assert.rejects(adapter.prepare({ ...billable(), signal: controller.signal }), (e) => e.code === 'preflight_deadline_passed', boundary);
    assert.equal(calls.length, boundary === 'already' ? 0 : 1, boundary);
    assert.deepEqual(host, boundary === 'host-prepare' ? ['prepare'] : [], boundary);
    assert.equal(lateHostReads, 0, 'cancellation stops even callback-capable host property access');
  }
});

test('public cancellation during credential resolution stops host preparation and reservation', async () => {
  const controller = new AbortController(); let hostPrepares = 0;
  const run = createLiveOpenRouterRunner({ signal: controller.signal, prepareHost() { hostPrepares += 1; return {}; } });
  const adapter = run.args.adapter;
  // The runner signal reaches prepare without being exposed to credential or host payloads.
  run.args.adapter = { ...adapter, async prepare(input) {
    const pending = adapter.prepare(input); controller.abort(); return pending;
  } };
  const result = await executeAuthorizedAccessCell(run.args);
  assert.equal(result.reason_code, 'preflight_deadline_passed');
  assert.equal(hostPrepares, 0); assert.equal(run.fixture.calls.reserve, 0); assert.equal(run.hostDispatches.length, 0);
});


test('direct preparation rejects inherited signal facades with zero credential or host effects', async () => {
  for (const kind of ['hostile', 'revoked', 'plain', 'state-shadow']) {
    for (const levels of [1, 3]) {
      const controller = new AbortController(); controller.abort(); let traps = 0;
      const wrapped = Proxy.revocable(controller.signal, {
        get(target, key, receiver) { traps += 1;
          if (key === 'aborted' || String(key) === 'Symbol(kAborted)') return false;
          return Reflect.get(target, key, receiver);
        }, getPrototypeOf() { traps += 1; throw new Error('prototype trap must not run'); },
      });
      let signal = ['plain', 'state-shadow'].includes(kind) ? controller.signal : wrapped.proxy;
      for (let level = 0; level < levels; level += 1) signal = Object.create(signal);
      if (kind === 'revoked') wrapped.revoke();
      if (kind === 'state-shadow') {
        const key = Object.getOwnPropertySymbols(controller.signal).find((candidate) => String(candidate) === 'Symbol(kAborted)');
        Object.defineProperty(signal, key, { value: false });
      }
      const calls = []; const host = [];
      const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort({ calls }),
        fetchImpl: async () => { throw new Error('network must not run'); }, dispatchPort: {
          async prepare() { host.push('prepare'); }, async dispatch() { host.push('dispatch'); } } });
      await assert.rejects(adapter.prepare({ ...billable(), signal }), (e) => e.code === 'invalid_abort_signal', `${kind}/${levels}`);
      assert.equal(calls.length, 0); assert.deepEqual(host, []); assert.equal(traps, 0);
    }
  }
});

test('direct dispatch rejects inherited signal facades without consuming a valid prepared value', async () => {
  for (const kind of ['hostile', 'revoked', 'plain', 'state-shadow']) {
    for (const levels of [1, 3]) {
      const controller = new AbortController(); controller.abort(); let traps = 0;
      const wrapped = Proxy.revocable(controller.signal, {
        get(target, key, receiver) { traps += 1;
          if (key === 'aborted' || String(key) === 'Symbol(kAborted)') return false;
          return Reflect.get(target, key, receiver);
        }, getPrototypeOf() { traps += 1; throw new Error('prototype trap must not run'); },
      });
      let signal = ['plain', 'state-shadow'].includes(kind) ? controller.signal : wrapped.proxy;
      for (let level = 0; level < levels; level += 1) signal = Object.create(signal);
      if (kind === 'revoked') wrapped.revoke();
      if (kind === 'state-shadow') {
        const key = Object.getOwnPropertySymbols(controller.signal).find((candidate) => String(candidate) === 'Symbol(kAborted)');
        Object.defineProperty(signal, key, { value: false });
      }
      const calls = []; const host = [];
      const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort({ calls }),
        fetchImpl: async () => { throw new Error('network must not run'); }, dispatchPort: {
          async prepare() { host.push('prepare'); }, async dispatch() { host.push('dispatch'); } } });
      const input = billable(); const prepared = await adapter.prepare(input);
      await assert.rejects(adapter.dispatch(dispatchInput(input, prepared, signal)), (e) => e.code === 'invalid_abort_signal', `${kind}/${levels}`);
      assert.equal(calls.length, 1); assert.deepEqual(host, ['prepare']); assert.equal(traps, 0);
      const active = new AbortController();
      await adapter.dispatch(dispatchInput(input, prepared, active.signal));
      assert.deepEqual(host, ['prepare', 'dispatch'], 'valid native control still dispatches once');
      await assert.rejects(adapter.dispatch(dispatchInput(input, prepared, active.signal)), (e) => e.code === 'credential_unavailable');
    }
  }
});


test('direct dispatch rechecks real elapsed and deterministic deadlines after signal composition', async () => {
  for (const mode of ['real', 'deterministic']) {
    let currentTime = clock(); const now = mode === 'real' ? Date.now : () => currentTime;
    const deadlineMs = now() + (mode === 'real' ? 200 : 30_000); const host = [];
    const port = grantCredentialPort({ mutate: (value) => ({ ...value, expires_at: new Date(deadlineMs + 60_000).toISOString() }) });
    const adapter = createOpenRouterImagesAdapter({ now, credentialPort: port, fetchImpl: interceptedFetch().fetchImpl,
      dispatchPort: { async dispatch() { host.push('dispatch'); } } });
    const input = billable('image_generation', { deadline_at: new Date(deadlineMs).toISOString() });
    const prepared = await adapter.prepare(input); const controller = new AbortController(); let reads = 0;
    Object.defineProperty(controller.signal, 'aborted', { get() {
      reads += 1;
      if (mode === 'real') { while (Date.now() < deadlineMs + 20) {} }
      else currentTime = deadlineMs + 1;
      return false;
    } });
    await assert.rejects(adapter.dispatch(dispatchInput(input, prepared, controller.signal)), (e) => e.code === 'preflight_deadline_passed', mode);
    assert.ok(reads > 0); assert.deepEqual(host, [], mode);
  }
});

test('the final dispatch clock rejects faults and catches cancellation after composition', async () => {
  for (const mode of ['fault', 'abort']) {
    const controller = new AbortController(); let armed = false; const host = [];
    const adapter = createOpenRouterImagesAdapter({ now() {
      if (armed && mode === 'fault') return NaN;
      if (armed && mode === 'abort') controller.abort();
      return clock();
    }, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl,
    dispatchPort: { async dispatch() { host.push('dispatch'); } } });
    const input = billable(); const prepared = await adapter.prepare(input);
    Object.defineProperty(controller.signal, 'aborted', { get() { armed = true; return false; } });
    await assert.rejects(adapter.dispatch(dispatchInput(input, prepared, controller.signal)),
      (e) => e.code === (mode === 'fault' ? 'adapter_unavailable' : 'preflight_deadline_passed'), mode);
    assert.deepEqual(host, []); armed = false;
    await adapter.dispatch(dispatchInput(input, prepared));
    assert.deepEqual(host, ['dispatch'], 'rejection did not consume prepared authority');
    await assert.rejects(adapter.dispatch(dispatchInput(input, prepared)), (e) => e.code === 'credential_unavailable');
  }
});

test('the final preparation clock cannot change the authority before host work', async () => {
  const input = billable(); const host = []; let armed = false; let mutateOnClock = false;
  const adapter = createOpenRouterImagesAdapter({ now() {
    if (mutateOnClock) input.target.configuration.provider_tag = 'changed-provider';
    return clock();
  }, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl,
  dispatchPort: { async dispatch() { host.push('dispatch'); }, get prepare() {
    if (armed) mutateOnClock = true;
    return async () => { host.push('prepare'); };
  } } });
  armed = true;
  await assert.rejects(adapter.prepare(input), (error) => error.code === 'unsupported_image_configuration');
  assert.deepEqual(host, []);
});

test('preparation refuses object-valued configuration hashes before credential-bearing host work', async () => {
  const input = billable(); const host = []; let accessorReads = 0;
  input.target.configuration_sha256 = { get pin() { accessorReads += 1; return digest('synthetic-pin'); } };
  const adapter = createOpenRouterImagesAdapter({ now: clock,
    credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl,
    dispatchPort: { async prepare() { host.push('prepare'); }, async dispatch() { host.push('dispatch'); } } });
  await assert.rejects(adapter.prepare(input), (error) => error.code === 'unsupported_image_configuration');
  assert.equal(accessorReads, 0);
  assert.deepEqual(host, []);
});

test('host preparation invokes the captured function without reading its own call property', async () => {
  const input = billable(); const host = []; let callReads = 0;
  const prepareHost = async () => { host.push('prepare'); };
  Object.defineProperty(prepareHost, 'call', { get() {
    callReads += 1;
    input.target.configuration.provider_tag = 'changed-provider';
    return async () => { host.push('override'); };
  } });
  const adapter = createOpenRouterImagesAdapter({ now: clock,
    credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl,
    dispatchPort: { prepare: prepareHost, async dispatch() { host.push('dispatch'); } } });
  assert.deepEqual(await adapter.prepare(input), { prepared: true });
  assert.equal(callReads, 0);
  assert.deepEqual(host, ['prepare']);
});

for (const operation of ['prepare', 'dispatch']) {
  for (const boundary of ['options-getter', 'final-clock']) {
    test(`host ${operation} retains its invocation intrinsic after the ${boundary}`, async () => {
      const originalApply = Reflect.apply;
      const calls = [];
      let interceptedCalls = 0;
      let interceptedCredential = false;
      let armed = false;
      let replaceOnClock = false;
      const replacement = (_host, _receiver, args) => {
        interceptedCalls += 1;
        interceptedCredential ||= args[0]?.credential?.token === TOKEN_CANARY;
        return { intercepted: true };
      };
      const host = function (input) {
        calls.push({ receiver: this === dispatchPort, credential: input.credential.token === TOKEN_CANARY });
        return { retained: true };
      };
      const dispatchPort = {
        get prepare() {
          if (operation !== 'prepare') return undefined;
          if (armed && boundary === 'final-clock') replaceOnClock = true;
          return host;
        },
        get dispatch() {
          if (armed && operation === 'dispatch' && boundary === 'final-clock') replaceOnClock = true;
          return operation === 'dispatch' ? host : async () => {};
        },
      };
      const { fetchImpl, requests } = interceptedFetch();
      try {
        const input = billable();
        const adapter = createOpenRouterImagesAdapter({
          now() {
            if (replaceOnClock) Reflect.apply = replacement;
            return clock();
          },
          credentialPort: grantCredentialPort(), fetchImpl,
          get dispatchPort() {
            if (boundary === 'options-getter') Reflect.apply = replacement;
            return dispatchPort;
          },
        });
        armed = operation === 'prepare';
        const prepared = await adapter.prepare(input);
        assert.deepEqual(prepared, { prepared: true });
        if (operation === 'dispatch') {
          armed = true;
          await adapter.dispatch(dispatchInput(input, prepared));
        }
      } finally {
        Reflect.apply = originalApply;
      }
      assert.equal(interceptedCalls, 0, 'a mutable global invocation function must never receive host input');
      assert.equal(interceptedCredential, false, 'the replacement must never receive even a synthetic credential');
      assert.deepEqual(calls, [{ receiver: true, credential: true }], 'invoke the captured host with its original receiver');
      assert.equal(requests.length, 0, 'the host fixture performs no external request');
    });
  }
}

for (const boundary of ['freeze', 'weakmap-set', 'weakmap-get', 'weakmap-delete', 'weakmap-constructor', 'trim', 'regexp-exec']) {
  test(`credential-bearing intrinsics remain private after replacing ${boundary}`, async () => {
    const original = { apply: Reflect.apply, freeze: Object.freeze, WeakMap,
      set: WeakMap.prototype.set, get: WeakMap.prototype.get, delete: WeakMap.prototype.delete,
      trim: String.prototype.trim, exec: RegExp.prototype.exec };
    let exposures = 0;
    let constructors = 0;
    const host = [];
    const inspect = (value) => {
      if (value === TOKEN_CANARY || value?.token === TOKEN_CANARY || value?.credential?.token === TOKEN_CANARY) exposures += 1;
    };
    const replace = () => {
      if (boundary === 'freeze') Object.freeze = (value) => { inspect(value); return original.freeze(value); };
      if (boundary === 'weakmap-set') original.WeakMap.prototype.set = function (key, value) {
        inspect(value); return original.apply(original.set, this, [key, value]);
      };
      if (boundary === 'weakmap-get') original.WeakMap.prototype.get = function (key) {
        const value = original.apply(original.get, this, [key]); inspect(value); return value;
      };
      if (boundary === 'weakmap-delete') original.WeakMap.prototype.delete = function (key) {
        inspect(original.apply(original.get, this, [key])); return original.apply(original.delete, this, [key]);
      };
      if (boundary === 'weakmap-constructor') globalThis.WeakMap = class extends original.WeakMap {
        constructor() { super(); constructors += 1; }
        set(key, value) { inspect(value); return original.apply(original.set, this, [key, value]); }
      };
      if (boundary === 'trim') String.prototype.trim = function () {
        inspect(this); return original.apply(original.trim, this, []);
      };
      if (boundary === 'regexp-exec') RegExp.prototype.exec = function (value) {
        inspect(value); return original.apply(original.exec, this, [value]);
      };
    };
    const { fetchImpl, requests } = interceptedFetch();
    try {
      const input = billable();
      const adapter = createOpenRouterImagesAdapter({ now: clock,
        credentialPort: grantCredentialPort(), fetchImpl,
        get dispatchPort() {
          replace();
          return { async prepare(args) { host.push(['prepare', args.credential.token === TOKEN_CANARY]); },
            async dispatch(args) { host.push(['dispatch', args.credential.token === TOKEN_CANARY]); } };
        },
      });
      const prepared = await adapter.prepare(input);
      await adapter.dispatch(dispatchInput(input, prepared));
      await assert.rejects(adapter.dispatch(dispatchInput(input, prepared)), (error) => error.code === 'credential_unavailable');
    } finally {
      Object.freeze = original.freeze;
      globalThis.WeakMap = original.WeakMap;
      original.WeakMap.prototype.set = original.set;
      original.WeakMap.prototype.get = original.get;
      original.WeakMap.prototype.delete = original.delete;
      String.prototype.trim = original.trim;
      RegExp.prototype.exec = original.exec;
    }
    assert.equal(exposures, 0, 'global replacements cannot observe even synthetic private credentials');
    assert.equal(constructors, 0, 'private prepared state must use the captured native constructor');
    assert.deepEqual(host, [['prepare', true], ['dispatch', true]]);
    assert.equal(requests.length, 0);
  });
}

for (const boundary of ['object-keys', 'array-map', 'json-stringify', 'set-has', 'descriptor-getter']) {
  test(`the final authority fence runs no replacement ${boundary} callback`, async () => {
    const original = { apply: Reflect.apply, keys: Object.keys, map: Array.prototype.map,
      stringify: JSON.stringify, has: Set.prototype.has,
      descriptorGet: Object.getOwnPropertyDescriptor(Object.prototype, 'get') };
    const restore = () => {
      Object.keys = original.keys; Array.prototype.map = original.map;
      JSON.stringify = original.stringify; Set.prototype.has = original.has;
      if (original.descriptorGet) Object.defineProperty(Object.prototype, 'get', original.descriptorGet);
      else delete Object.prototype.get;
    };
    const input = billable();
    let armed = false;
    let pending = false;
    let installed = false;
    let lateCallbacks = 0;
    let hostCalls = 0;
    let outcome;
    let failure;
    const mutate = () => { lateCallbacks += 1; input.grant_ref = 'grant:test:changed-by-global'; restore(); };
    const adapter = createOpenRouterImagesAdapter({ now() {
      if (pending && !installed) {
        installed = true;
        if (boundary === 'object-keys') Object.keys = (value) => { mutate(); return original.keys(value); };
        if (boundary === 'array-map') Array.prototype.map = function (...args) {
          mutate(); return original.apply(original.map, this, args);
        };
        if (boundary === 'json-stringify') JSON.stringify = (...args) => { mutate(); return original.stringify(...args); };
        if (boundary === 'set-has') Set.prototype.has = function (value) {
          mutate(); return original.apply(original.has, this, [value]);
        };
        if (boundary === 'descriptor-getter') Object.defineProperty(Object.prototype, 'get', {
          configurable: true, get() { mutate(); return undefined; },
        });
      }
      return clock();
    }, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl,
    dispatchPort: { get prepare() {
      if (armed) pending = true;
      return () => { hostCalls += 1; restore(); };
    }, async dispatch() {} } });
    armed = true;
    try { outcome = await adapter.prepare(input); }
    catch (error) { failure = error; }
    finally { restore(); }
    assert.equal(installed, true);
    assert.equal(lateCallbacks, 0, 'no new callback can mutate authority after its final capture');
    assert.equal(failure, undefined);
    assert.deepEqual(outcome, { prepared: true });
    assert.equal(hostCalls, 1);
    assert.equal(input.grant_ref, GRANT);
  });
}

test('prepare rejects deadlines crossed by host accessors or final binding getters before sharing credentials', async () => {
  for (const boundary of ['host-accessor', 'binding-getter']) {
    let currentTime = clock();
    const deadlineMs = currentTime + 30_000;
    const input = billable('image_generation', { deadline_at: new Date(deadlineMs).toISOString() });
    const originalModel = input.target.model;
    const calls = [];
    const host = [];
    let resolved = false;
    let hostRead = false;
    Object.defineProperty(input.target, 'model', { enumerable: true, get() {
      if (hostRead && boundary === 'binding-getter') currentTime = deadlineMs + 1;
      return originalModel;
    } });
    const credentialPort = grantCredentialPort({ calls, mutate(value) { resolved = true; return value; } });
    const adapter = createOpenRouterImagesAdapter({ now: () => currentTime, credentialPort,
      fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
        get prepare() {
          if (resolved) {
            hostRead = true;
            if (boundary === 'host-accessor') currentTime = deadlineMs + 1;
          }
          return async () => { host.push('prepare'); return {}; };
        },
        async dispatch() { host.push('dispatch'); },
      } });
    await assert.rejects(adapter.prepare(input), (e) => e.code === 'preflight_deadline_passed', boundary);
    assert.equal(calls.length, 1, boundary);
    assert.equal(hostRead, true, boundary);
    assert.deepEqual(host, [], `${boundary}: an expired operation must not expose credentials to host preparation`);
  }
});

test('the final prepare clock rejects faults and catches cancellation after host accessor callbacks', async () => {
  for (const mode of ['fault', 'abort']) {
    const controller = new AbortController();
    const host = [];
    let resolved = false;
    let armed = false;
    const adapter = createOpenRouterImagesAdapter({ now() {
      if (armed && mode === 'fault') return NaN;
      if (armed && mode === 'abort') controller.abort();
      return clock();
    }, credentialPort: grantCredentialPort({ mutate(value) { resolved = true; return value; } }),
    fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
      get prepare() {
        if (resolved) armed = true;
        return async () => { host.push('prepare'); return {}; };
      },
      async dispatch() { host.push('dispatch'); },
    } });
    await assert.rejects(adapter.prepare({ ...billable(), signal: controller.signal }),
      (e) => e.code === (mode === 'fault' ? 'adapter_unavailable' : 'preflight_deadline_passed'), mode);
    assert.deepEqual(host, [], `${mode}: the final deadline fence must run before host preparation`);
  }
});

test('validated credential response snapshots survive a post-validation clock mutation', async () => {
  for (const mode of ['token', 'all-fields']) {
    let response; const host = []; const inner = grantCredentialPort();
    const adapter = createOpenRouterImagesAdapter({ now() {
      if (response) {
        response.token = 'mutated-synthetic-token\ninvalid';
        if (mode === 'all-fields') {
          response.decision = 'denied'; response.evidence_mode = 'mock'; response.expires_at = new Date(clock() - 1).toISOString();
          response.binding.target_binding_sha256 = digest('changed');
          response.evidence.ref = 'bad\nref'; response.evidence.independent_review.ref = 'bad\nreview';
        }
      }
      return clock();
    }, credentialPort: { evidence_mode: 'live', async resolveCredential(request) {
      response = await inner.resolveCredential(request); return response;
    } }, fetchImpl: interceptedFetch().fetchImpl, dispatchPort: {
      async prepare(args) { host.push(args.credential.token === TOKEN_CANARY && !/[\r\n]/.test(args.credential.token)); },
      async dispatch(args) { host.push(args.credential.token === TOKEN_CANARY && !/[\r\n]/.test(args.credential.token)); } } });
    const input = billable(); const prepared = await adapter.prepare(input);
    await adapter.dispatch(dispatchInput(input, prepared));
    assert.deepEqual(host, [true, true], mode);
    assert.equal(Object.isFrozen(response), false, 'the resolver-owned response is not mutated/frozen by capture');
  }
});

test('credential response scalars binding and pinned evidence are read only once', async () => {
  const reads = new Map(); const inner = grantCredentialPort();
  const countFields = (value, prefix) => {
    for (const key of Object.keys(value)) {
      const captured = value[key]; Object.defineProperty(value, key, { enumerable: true, configurable: true,
        get() { const label = `${prefix}.${key}`; reads.set(label, (reads.get(label) ?? 0) + 1); return captured; } });
    }
  };
  const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: { evidence_mode: 'live', async resolveCredential(request) {
    const response = await inner.resolveCredential(request);
    countFields(response.binding, 'binding'); countFields(response.evidence.independent_review, 'review');
    countFields(response.evidence, 'evidence'); countFields(response, 'response'); return response;
  } }, fetchImpl: interceptedFetch().fetchImpl, dispatchPort: { async dispatch() {} } });
  const input = billable(); await adapter.dispatch(dispatchInput(input, await adapter.prepare(input)));
  for (const [name, count] of reads) assert.equal(count, 1, name);
});

test('read-only credential lookup sends the captured validated token after clock mutation', async () => {
  const { fetchImpl, requests } = interceptedFetch(); let response; const inner = credentialPort();
  const adapter = createOpenRouterImagesAdapter({ now() {
    if (response) response.token = 'mutated-synthetic-token\ninvalid'; return clock();
  }, credentialPort: { evidence_mode: 'live', async resolveCredential(request) {
    response = await inner.resolveCredential(request); return response;
  } }, fetchImpl });
  await inspect(adapter);
  assert.equal(requests[0].init.headers.authorization === `Bearer ${TOKEN_CANARY}`, true);
  assert.equal(/[\r\n]/.test(requests[0].init.headers.authorization), false);
});


test('a host dispatch accessor that consumes the deadline cannot start dispatch', async () => {
  let current = clock(); let armed = false; const host = []; const input = billable();
  const adapter = createOpenRouterImagesAdapter({ now: () => current, credentialPort: grantCredentialPort(), fetchImpl: interceptedFetch().fetchImpl,
    dispatchPort: { get dispatch() {
      if (armed) current = Date.parse(input.deadline_at) + 1;
      return async () => { host.push('dispatch'); };
    } } });
  const prepared = await adapter.prepare(input); armed = true;
  await assert.rejects(adapter.dispatch(dispatchInput(input, prepared)), (e) => e.code === 'preflight_deadline_passed');
  assert.deepEqual(host, []);
});

test('owned dispatch cancellation follows shadowed native callers despite synthetic events and listener shadows', async () => {
  const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
  for (const shadow of ['value', 'getter']) {
    for (const interference of ['stop-propagation', 'synthetic-source', 'synthetic-composite']) {
      const controller = new AbortController();
      Object.defineProperty(controller.signal, 'aborted', shadow === 'value'
        ? { value: false } : { get() { return false; } });
      if (interference === 'stop-propagation') {
        EventTarget.prototype.addEventListener.call(controller.signal, 'abort', (event) => event.stopImmediatePropagation());
      }
      let callerListenerReads = 0;
      for (const method of ['addEventListener', 'removeEventListener']) {
        Object.defineProperty(controller.signal, method, { get() {
          callerListenerReads += 1;
          throw new Error('caller listener methods must not control owned cancellation');
        } });
      }
      let hostSignal;
      const adapter = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort(),
        fetchImpl: interceptedFetch().fetchImpl,
        dispatchPort: { async dispatch(input) { hostSignal = input.signal; return { host: 'result' }; } } });
      const input = billable();
      const prepared = await adapter.prepare(input);
      await adapter.dispatch(dispatchInput(input, prepared, controller.signal));
      assert.equal(nativeAborted.call(hostSignal), false, `${shadow}/${interference} starts active`);
      if (interference === 'synthetic-source') {
        EventTarget.prototype.dispatchEvent.call(controller.signal, new Event('abort'));
      } else if (interference === 'synthetic-composite') {
        EventTarget.prototype.dispatchEvent.call(hostSignal, new Event('abort'));
      }
      assert.equal(nativeAborted.call(hostSignal), false, 'an event cannot forge native cancellation');
      controller.abort();
      assert.equal(nativeAborted.call(hostSignal), true, `${shadow}/${interference} preserves later native cancellation`);
      assert.equal(callerListenerReads, 0, 'only the adapter-owned composite is observed');
    }
  }
});
