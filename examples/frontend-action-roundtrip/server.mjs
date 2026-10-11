/** Loopback only, explicit MOCK trusted host. No actual authentication or calls. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntegratedHost, fixturePrincipal } from '../../fixtures/controls/integrated-host.mjs';
const port = Number(process.env.CONTROLS_FIXTURE_PORT ?? 4317);
let dir = mkdtempSync(join(tmpdir(), 'creative-integrated-browser-')), host = await createIntegratedHost(dir);
const files = { '/': ['index.html', 'text/html'], '/app.mjs': ['app.mjs', 'text/javascript'], '/messages.mjs': ['messages.mjs', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/schema.mjs': ['../../src/controls/schema.mjs', 'text/javascript'] };
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const mode = { mode: 'mock', authority: 'MOCK trusted host fixture; no actual membership', transport: 'native provider with intercepted offline fetch', backend: 'actual local API/planning/SQLite versions/telemetry' };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && files[path]) {
      const [file, type] = files[path]; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" });
      return res.end(await readFile(new URL(file, import.meta.url)));
    }
    if (req.method === 'GET' && path === '/api/schema') return json(res, { ...mode, schema: host.schema(), counters: host.counts() });
    if (req.method === 'GET' && path === '/api/counters') return json(res, { ...mode, ...host.counts() });
    if (req.method === 'GET' && path === '/api/history') return json(res, { ...mode, ...await host.history(), selection: host.selection() });
    if (req.method === 'GET' && path === '/api/artifact') {
      const value = await host.artifact(new URL(req.url, 'http://localhost').searchParams.get('design_version_id'));
      if (!value) return json(res, { code: 'permission' }, 403);
      res.writeHead(200, { 'Content-Type': value.artifact.media_type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" }); return res.end(Buffer.from(value.bytes));
    }
    if (req.method !== 'POST' || !['/api/apply', '/api/cancel', '/api/dispatch', '/api/compare', '/api/restore', '/__fixture/state', '/__fixture/reset'].includes(path)) return json(res, { code: 'not_found' }, 404);
    if (!req.headers['content-type']?.startsWith('application/json')) return json(res, { code: 'validation' }, 415);
    if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, { code: 'permission' }, 403);
    let bytes = '', size = 0; for await (const chunk of req) { size += chunk.length; if (size > 32768) return json(res, { code: 'validation' }, 413); bytes += chunk; }
    const payload = JSON.parse(bytes);
    if (path === '/api/apply') return json(res, { ...mode, ...await host.adapter.apply(fixturePrincipal, payload), counters: host.counts() });
    if (path === '/api/cancel') return json(res, { ...mode, ...await host.adapter.cancel(fixturePrincipal, payload.operation_id ?? host.adapter.lookup(fixturePrincipal, payload.action_id)?.operation_id), counters: host.counts() });
    if (path === '/api/compare') return json(res, { ...mode, ...await host.compare(payload.design_version_id), counters: host.counts() });
    if (path === '/api/restore') return json(res, { ...mode, ...await host.restore(payload.design_version_id, payload.expected_selection_revision, payload.action_id), counters: host.counts() });
    if (path === '/api/dispatch') return json(res, { ...mode, ...host.adapter.store.dispatch(fixturePrincipal, payload.operation_id), counters: host.counts() });
    if (path === '/__fixture/reset') { host.close(); rmSync(dir, { recursive: true, force: true }); dir = mkdtempSync(join(tmpdir(), 'creative-integrated-browser-')); host = await createIntegratedHost(dir); }
    else {
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
