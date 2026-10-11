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
  const calls = [];
  const composed = createOpenRouterImagesAdapter({ now: clock, credentialPort: grantCredentialPort({ calls }), fetchImpl, dispatchPort: {
    async prepare(input) { seen.push(['prepare', input.cell_id, input.credential.token]); return { host_prepared: input.cell_id }; },
    async dispatch(input) { seen.push(['dispatch', input.cell_id, input.credential.token, input.prepared, input.signal instanceof AbortSignal]); return { host: 'result' }; },
  } });
  const input = billable('image_edit');
  const prepared = await composed.prepare(input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].purpose, 'authorized_billable_operation', 'the OpenAI billable purpose');
  assert.equal(calls[0].grant_ref, GRANT);
  assert.ok(!JSON.stringify(prepared).includes(TOKEN_CANARY), 'the credential is not in the value the runner holds');
  assert.deepEqual(await composed.dispatch(dispatchInput(input, prepared)), { host: 'result' });
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
  ]) await assert.rejects(composed.dispatch({ ...bad, metering: meteringInput() }),
    (error) => ['credential_unavailable', 'unsupported_image_configuration'].includes(error.code), name);
  assert.equal(seen.filter(([kind]) => kind === 'dispatch').length, 1, 'no rejected dispatch reached the host port');
  assert.equal(seen.length, before + 1, 'only the one valid prepare ran after the rejections');
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
  assert.deepEqual(await adapter.dispatch(dispatchInput(input, prepared, proxiedSignal)), { host: 'result' },
    'Node accepts a proxy over a genuine native signal through its native composition API');
  assert.ok(hostSignals[1] instanceof AbortSignal, 'the host receives the native composite, not the caller proxy');
  proxiedCaller.abort();
  assert.equal(hostSignals[1].aborted, true, 'cancellation through the native caller target reaches the host');
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
    (error) => error.code === 'credential_unavailable');
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
  const real = createOpenRouterImagesAdapter({ credentialPort: credentialPort(), fetchImpl });
  const unknownVerifier = (input) => ({
    decision: 'unknown', evidence_mode: 'mock', cell_id: input.cell_id, owner_role: input.owner_role, operation_kind: input.operation_kind,
    target_binding: input.target_binding, scope: input.scope, deadline_at: input.deadline_at,
    operation_permission: 'unknown', quota: 'unknown', checked_at: input.at,
    expires_at: new Date(Date.parse(input.deadline_at) + 1000).toISOString(),
    evidence: pinned('cap'), owner_evidence: { ...pinned('owner'), owner_role: input.owner_role }, protocol: pinned('protocol'),
  });
  const fixture = createMockAccessFixture({ cellId: 'image_generation', provider: 'openrouter', capabilityDecision: unknownVerifier,
    now: new Date(Date.now() + 5000).toISOString() });
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
    capabilityDecision: () => { throw new Error('verifier unavailable'); }, now: new Date(Date.now() + 5000).toISOString() });
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

  const live = await executeAuthorizedAccessCell({ ...createMockAccessFixture({ cellId: 'image_generation', provider: 'openrouter' }).args, adapter: real });
  assert.equal(live.status, 'blocked');
  assert.equal(live.reason_code, 'mock_requires_fixture_ports');
  assert.equal(requests.length, 4, 'the live adapter is not invoked by a mock run');
});
