import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createOpenRouterImagesAdapter,
  executeAuthorizedAccessCell,
  openRouterCatalogEndpoint,
  runAccessPreflight,
  validateOpenRouterImageTarget,
} from '../../src/preflight/index.mjs';
import { OPENROUTER_FIXTURE_MODEL, accessPlan, createMockAccessFixture, fixtureScope } from '../../fixtures/preflight/access-ports.mjs';

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
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        evidence: pinned('credential'),
      });
    },
  };
}

const keyBody = { data: { label: 'sk-or-redacted', limit: 10, limit_remaining: 9.5, usage: 0.5, is_free_tier: false } };
const catalogBody = { data: { endpoints: [
  { provider_tag: 'other-provider', supported_parameters: {}, pricing: {} },
  { provider_tag: 'synthetic-provider', supported_parameters: { aspect_ratio: { type: 'enum', values: ['1:1', 'auto'] } }, pricing: { image: '0.04' } },
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
      const observation = await inspect(createOpenRouterImagesAdapter({ credentialPort: port, fetchImpl }), cellId);
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
      for (const secret of [TOKEN_CANARY, 'env-canary-must-never-be-read', 'sk-or-redacted', '9.5', '0.04']) {
        assert.ok(!serialized.includes(secret), `observation leaked ${secret}`);
      }
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
    const observation = await inspect(createOpenRouterImagesAdapter({ credentialPort: credentialPort(), fetchImpl }));
    assert.equal(observation.authentication, expected.authentication, name);
    assert.equal(observation.model_listing, expected.model_listing, name);
    assert.equal(observation.operation_permission, 'unknown', name);
    assert.equal(observation.quota, 'unknown', name);
  }
  for (const url of [KEY_URL, CATALOG_URL]) {
    const { fetchImpl } = interceptedFetch({ [url]: 'throw' });
    await assert.rejects(inspect(createOpenRouterImagesAdapter({ credentialPort: credentialPort(), fetchImpl })),
      (error) => error.code === 'access_probe_unavailable' && !String(error.message).includes('secret-detail'));
  }
});

test('invalid targets and credentials stop before any request, and construction needs explicit ports', async () => {
  const wrongTarget = target();
  wrongTarget.endpoint = 'https://api.openai.com/v1/images/generations';
  const { fetchImpl, requests } = interceptedFetch();
  const adapter = createOpenRouterImagesAdapter({ credentialPort: credentialPort(), fetchImpl });
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
    ['expired credential', (value) => ({ ...value, expires_at: new Date(Date.now() - 1000).toISOString() })],
    ['unpinned evidence', (value) => ({ ...value, evidence: { ref: 'x' } })],
  ]) {
    const adapterWithBadPort = createOpenRouterImagesAdapter({ credentialPort: credentialPort({ mutate }), fetchImpl });
    await assert.rejects(inspect(adapterWithBadPort), (error) => error.code === 'credential_unavailable', name);
  }
  assert.equal(requests.length, 0, 'no request is sent before the exact credential binding is verified');
  assert.throws(() => createOpenRouterImagesAdapter({ credentialPort: credentialPort() }), (error) => error.code === 'adapter_unavailable');
  assert.throws(() => createOpenRouterImagesAdapter({ credentialPort: { ...credentialPort(), evidence_mode: 'mock' }, fetchImpl }),
    (error) => error.code === 'credential_unavailable');
  assert.throws(() => createOpenRouterImagesAdapter({ credentialPort: credentialPort(), fetchImpl, dispatchPort: {} }),
    (error) => error.code === 'adapter_unavailable');
});

test('billable dispatch exists only through a trusted host port and re-checks the OpenRouter pin', async () => {
  const { fetchImpl, requests } = interceptedFetch();
  const bare = createOpenRouterImagesAdapter({ credentialPort: credentialPort(), fetchImpl });
  assert.equal(bare.prepare, undefined);
  await assert.rejects(bare.dispatch({ cell_id: 'image_generation', target: target() }), (error) => error.code === 'adapter_unavailable');
  const seen = [];
  const composed = createOpenRouterImagesAdapter({ credentialPort: credentialPort(), fetchImpl, dispatchPort: {
    async prepare(input) { seen.push(['prepare', input.cell_id]); return { ok: true }; },
    async dispatch(input) { seen.push(['dispatch', input.cell_id]); return { host: 'result' }; },
  } });
  assert.deepEqual(await composed.dispatch({ cell_id: 'image_edit', target: target('image_edit') }), { host: 'result' });
  await composed.prepare({ cell_id: 'image_generation', target: target() });
  const wrong = target();
  wrong.service = 'openai';
  await assert.rejects(composed.dispatch({ cell_id: 'image_generation', target: wrong }), (error) => error.code === 'unsupported_image_configuration');
  await assert.rejects(composed.prepare({ cell_id: 'image_generation', target: wrong }));
  assert.deepEqual(seen, [['dispatch', 'image_edit'], ['prepare', 'image_generation']]);
  assert.equal(requests.length, 0, 'the metadata adapter never sends a paid request');
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
  const wrapped = { ...fixture.adapter, evidence_mode: 'mock',
    async inspect(input) { return { ...(await real.inspect(input)), evidence_mode: 'mock' }; } };
  const result = await executeAuthorizedAccessCell({ ...fixture.args, adapter: wrapped });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason_code, 'operation_permission_unknown');
  assert.equal(fixture.calls.dispatch, 0);
  assert.equal(fixture.calls.reserve, 0);
  assert.equal(requests.length, 2);

  const live = await executeAuthorizedAccessCell({ ...createMockAccessFixture({ cellId: 'image_generation', provider: 'openrouter' }).args, adapter: real });
  assert.equal(live.status, 'blocked');
  assert.equal(live.reason_code, 'mock_requires_fixture_ports');
  assert.equal(requests.length, 2, 'the live adapter is not invoked by a mock run');
});
