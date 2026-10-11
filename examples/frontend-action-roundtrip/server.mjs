/** Loopback only, explicit MOCK trusted host. No actual authentication or calls. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntegratedHost, fixturePrincipal } from '../../fixtures/controls/integrated-host.mjs';
const port = Number(process.env.CONTROLS_FIXTURE_PORT ?? 4317);
let dir = mkdtempSync(join(tmpdir(), 'creative-integrated-browser-')), host = await createIntegratedHost(dir, { enableComposition: true });
const files = { '/': ['index.html', 'text/html'], '/app.mjs': ['app.mjs', 'text/javascript'], '/messages.mjs': ['messages.mjs', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/schema.mjs': ['../../src/controls/schema.mjs', 'text/javascript'],
  '/inspection-presentation.html': ['inspection-presentation.html', 'text/html'],
  '/inspection-presentation.mjs': ['inspection-presentation.mjs', 'text/javascript'],
  '/inspection-consumer.mjs': ['../../src/controls/inspection-consumer.mjs', 'text/javascript'],
  '/inspection-view.mjs': ['../../src/controls/inspection-view.mjs', 'text/javascript'],
  '/public-result.mjs': ['../../src/controls/public-result.mjs', 'text/javascript'],
  '/inspection-inputs.json': ['../../fixtures/controls/inspection-presentation-inputs.json', 'application/json'] };
Object.assign(files, { '/composition.html': ['composition.html', 'text/html'], '/composition-app.mjs': ['composition-app.mjs', 'text/javascript'], '/composition-view.mjs': ['../../src/controls/composition-view.mjs', 'text/javascript'] });
// This explicit MOCK switch tests trusted principal isolation, not application authentication.
const compositionPrincipal = req => req.headers['x-mock-controls-principal'] === 'other-tenant' ? { ...fixturePrincipal, tenant_id: 'other_fixture_tenant' } : req.headers['x-mock-controls-principal'] === 'other-actor' ? { ...fixturePrincipal, actor_id: 'other_fixture_actor' } : fixturePrincipal;
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const mode = { mode: 'mock', authority: 'MOCK trusted host fixture; no actual membership', transport: 'native provider with intercepted offline fetch', backend: 'actual local API/planning/SQLite versions/telemetry' };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && files[path]) {
      const [file, type] = files[path]; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" });
      return res.end(await readFile(new URL(file, import.meta.url)));
    }
    if (req.method === 'GET' && path === '/api/inspection/latest') return json(res, { view: await host.inspection.latest(fixturePrincipal), repair: await host.inspection.latestRepair(fixturePrincipal), source: await host.inspection.currentSource(fixturePrincipal), counters: host.counts() });
    if (req.method === 'GET' && path === '/api/schema') return json(res, { ...mode, schema: host.schema(), counters: host.counts() });
    if (req.method === 'GET' && path === '/api/counters') return json(res, { ...mode, ...host.counts() });
    if (req.method === 'GET' && path === '/api/composition/history') {
      const query = new URL(req.url, 'http://localhost').searchParams, options = {};
      if (query.has('limit')) options.limit = Number(query.get('limit'));
      if (query.has('after_revision_id')) options.after_revision_id = query.get('after_revision_id');
      return json(res, { view: await host.composition.history(compositionPrincipal(req), options), counters: host.counts() });
    }
    if (req.method === 'GET' && path === '/api/composition/current') return json(res, { view: await host.composition.current(compositionPrincipal(req)), counters: host.counts() });
    if (req.method === 'GET' && path === '/api/composition/preview') {
      const query = new URL(req.url, 'http://localhost').searchParams;
      const value = await host.composition.preview(compositionPrincipal(req), Object.fromEntries(['revision_id','revision_sha256','preview_sha256'].map(k => [k, query.get(k)])));
      if (!value) return json(res, { code: 'permission' }, 403);
      res.writeHead(200, { 'Content-Type': value.metadata.mime_type, 'Content-Length': value.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" }); return res.end(value.bytes);
    }
    if (req.method === 'GET' && path === '/__fixture/native-evidence') {
      const value = host.nativeEvidence(new URL(req.url, 'http://localhost').searchParams.get('action_id'));
      return json(res, value ?? { code: 'permission' }, value ? 200 : 403);
    }
    if (req.method === 'GET' && path === '/api/history') return json(res, { ...mode, ...await host.history(), selection: host.selection() });
    if (req.method === 'GET' && path === '/api/artifact') {
      const value = await host.artifact(new URL(req.url, 'http://localhost').searchParams.get('design_version_id'));
      if (!value) return json(res, { code: 'permission' }, 403);
      res.writeHead(200, { 'Content-Type': value.artifact.media_type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" }); return res.end(Buffer.from(value.bytes));
    }
    if (req.method !== 'POST' || !['/api/artwork/retry','/api/artwork/status','/api/composition/apply','/api/composition/retry','/api/composition/lookup','/api/composition/cancel','/api/inspection', '/api/inspection/lookup', '/api/inspection/cancel', '/api/inspection/repair', '/api/apply', '/api/cancel', '/api/dispatch', '/api/compare', '/api/restore', '/__fixture/state', '/__fixture/reset'].includes(path)) return json(res, { code: 'not_found' }, 404);
    if (!req.headers['content-type']?.startsWith('application/json')) return json(res, { code: 'validation' }, 415);
    if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, { code: 'permission' }, 403);
    let bytes = '', size = 0; for await (const chunk of req) { size += chunk.length; if (size > 32768) return json(res, { code: 'validation' }, 413); bytes += chunk; }
    const payload = JSON.parse(bytes);
    if (path === '/api/composition/apply') return json(res, { result: await host.composition.apply(compositionPrincipal(req), payload), counters: host.counts() });
    if (path === '/api/composition/lookup') return json(res, { result: await host.composition.lookup(compositionPrincipal(req), payload.action_id), counters: host.counts() });
    if (path === '/api/composition/retry') return json(res, { result: await host.composition.retry(compositionPrincipal(req), payload.action_id), counters: host.counts() });
    if (path === '/api/composition/cancel') return json(res, { result: await host.composition.cancel(compositionPrincipal(req), payload.action_id), counters: host.counts() });
    if (path === '/api/artwork/retry') return json(res, { ...mode, ...await host.adapter.retryExisting(fixturePrincipal, payload.action_id), counters: host.counts() });
    if (path === '/api/artwork/status') return json(res, { ...mode, ...await host.adapter.readExisting(fixturePrincipal, payload.action_id), counters: host.counts() });
    if (path === '/api/inspection') return json(res, { view: await host.inspection.start(fixturePrincipal, payload), counters: host.counts() });
    if (path === '/api/inspection/lookup') return json(res, { view: await host.inspection.lookup(fixturePrincipal, payload.inspection_action_id), counters: host.counts() });
    if (path === '/api/inspection/cancel') return json(res, { view: await host.inspection.cancel(fixturePrincipal, payload.inspection_action_id), counters: host.counts() });
    if (path === '/api/inspection/repair') return json(res, { repair: await host.inspection.repair(fixturePrincipal, payload), counters: host.counts() });
    if (path === '/api/apply') return json(res, { ...mode, ...await host.adapter.apply(fixturePrincipal, payload), counters: host.counts() });
    if (path === '/api/cancel') return json(res, { ...mode, ...await host.adapter.cancel(fixturePrincipal, payload.operation_id ?? host.adapter.lookup(fixturePrincipal, payload.action_id)?.operation_id), counters: host.counts() });
    if (path === '/api/compare') return json(res, { ...mode, ...await host.compare(payload.design_version_id), counters: host.counts() });
    if (path === '/api/restore') return json(res, { ...mode, ...await host.restore(payload.design_version_id, payload.expected_selection_revision, payload.action_id), counters: host.counts() });
    if (path === '/api/dispatch') return json(res, { ...mode, ...host.adapter.store.dispatch(fixturePrincipal, payload.operation_id), counters: host.counts() });
    if (path === '/__fixture/reset') {
      const nativeFormat = payload.native_format ?? 'png';
      if (!['png', 'jpeg', 'webp'].includes(nativeFormat)) return json(res, { code: 'validation' }, 400);
      host.close(); rmSync(dir, { recursive: true, force: true }); dir = mkdtempSync(join(tmpdir(), 'creative-integrated-browser-'));
      host = await createIntegratedHost(dir, { nativeFormat, enableComposition: true, lockLogo: payload.lock_logo !== false });
    }
    else {
      if (payload.inspection_fault) host.policy.inspection_fault = payload.inspection_fault;
      if (payload.inspection_usage) host.policy.inspection_usage = payload.inspection_usage;
      if (payload.inspection_bucket) host.policy.inspection_bucket = payload.inspection_bucket;
      if (payload.recommend_repair) host.policy.recommend_repair = true;
      if (typeof payload.repair_units === 'number') host.policy.repair_units = payload.repair_units;
      if (payload.revoke_inspect) host.policy.can_inspect = false;
      if (payload.actor_expired) host.policy.actor_expired = true;
      if (payload.advance_ms) host.advance(payload.advance_ms);
      if (payload.revoke) host.policy.can_apply = false;
      if (payload.revoke_read) host.policy.can_read = false;
      if (payload.revoke_asset) host.policy.permitted_asset_ids = [];
      if (payload.invalidate) await host.invalidate();
      if (payload.block) host.block(payload.block);
      if (payload.release) host.release();
      if (payload.restart) host.restartAdapter();
      if (payload.provider_fault) host.setProviderFault(payload.provider_fault);
      if (payload.native_fault) host.policy.native_fault = payload.native_fault;
      if (payload.map_native_usage === false) host.policy.map_native_usage = false;
    }
    return json(res, { ...mode, ok: true, counters: host.counts() });
  } catch { json(res, { ...mode, ok: false, code: 'validation' }, 400); }
});
server.listen(port, '127.0.0.1', () => console.log(`MOCK integrated controls fixture http://127.0.0.1:${port}; actual local API/store, intercepted transport`));
const stop = () => server.close(() => { host.close(); rmSync(dir, { recursive: true, force: true }); process.exit(0); });
process.on('SIGTERM', stop); process.on('SIGINT', stop);
