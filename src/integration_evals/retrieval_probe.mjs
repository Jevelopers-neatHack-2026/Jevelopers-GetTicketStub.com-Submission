import { gzipSync } from 'node:zlib';
import { probeChunkedWire } from './retrieval_wire.mjs';

export async function probeRetrieval(api, fixtures, metadataUrl) {
  const { SafeFetcher, RetrievalError, DEFAULT_RUN_LIMITS: limits } = api;
  const { startFixture, localTestSeam, fixtureUrl } = fixtures;
  const counters = { protected_connections: 0, protected_requests: 0, allowed_connections: 0, allowed_requests: 0 };
  const protectedServer = await startFixture((_request, response) => {
    counters.protected_requests++;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('inert protected fixture');
  });
  protectedServer.server.on('connection', () => counters.protected_connections++);
  const protectedUrl = `http://127.0.0.1:${protectedServer.port}/`;
  const rows = [];
  let allowed;
  try {
    const compressed = gzipSync(Buffer.alloc(limits.decodedTextBytesPerRequest + 1, 97));
    allowed = await startFixture((request, response) => {
      counters.allowed_requests++;
      const route = request.url;
      if (route === '/private') {
        response.writeHead(302, { location: protectedUrl });
        response.end();
      } else if (route === '/loop') {
        response.writeHead(302, { location: '/loop' });
        response.end();
      } else if (route === '/wire') {
        response.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(limits.wireBytesPerRequest + 1) });
        response.flushHeaders();
      } else if (route === '/decoded') {
        response.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip', 'content-length': String(compressed.length) });
        response.end(compressed);
      } else {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('controlled retrieval bytes');
      }
    });
    allowed.server.on('connection', () => counters.allowed_connections++);
    const seam = localTestSeam({ port: allowed.port });
    const url = route => fixtureUrl(allowed.port, route);
    const attempt = async (id, fetcher, target) => {
      const before = { ...counters };
      let code = 'accepted';
      let known_bytes = false;
      try {
        const result = await fetcher.fetch(target);
        known_bytes = Buffer.from(result.bytes).toString('utf8') === 'controlled retrieval bytes';
      } catch (error) {
        if (!(error instanceof RetrievalError)) throw error;
        code = error.code;
      }
      const row = { id, code, known_bytes,
        protected_connections: counters.protected_connections - before.protected_connections,
        protected_requests: counters.protected_requests - before.protected_requests,
        allowed_connections: counters.allowed_connections - before.allowed_connections,
        allowed_requests: counters.allowed_requests - before.allowed_requests };
      rows.push(row);
      return row;
    };
    const baseline = await attempt('allowed', new SafeFetcher(seam), url('/allowed'));
    const rejected = [];
    const parser_rows = [];
    for (const [id, target] of [
      ['loopback', protectedUrl],
      ['private', 'http://10.0.0.1/'],
      ['metadata', metadataUrl],
      ['encoded-ipv4', `http://2130706433:${protectedServer.port}/`],
      ['ipv6-loopback', 'http://[::1]/'],
      ['unsupported-scheme', 'file:///inert-fixture'],
      ['redirect-private', url('/private')],
    ]) {
      if (id !== 'redirect-private') {
        let code = 'accepted';
        try { api.parseAndValidateUrl(target); }
        catch (error) {
          if (!(error instanceof RetrievalError)) throw error;
          code = error.code;
        }
        parser_rows.push({ id, code });
      }
      rejected.push(await attempt(id, new SafeFetcher(seam), target));
    }
    const loop = await attempt('redirect-loop', new SafeFetcher(seam), url('/loop'));
    const wire = await attempt('wire-limit', new SafeFetcher(seam), url('/wire'));
    const decoded = await attempt('decoded-limit', new SafeFetcher(seam), url('/decoded'));
    const budget = new SafeFetcher(seam);
    for (let index = 0; index < limits.requests; index++) await attempt(`request-${index}`, budget, url('/budget'));
    const exhausted = await attempt('request-limit', budget, url('/budget'));
    const chunked_wire = await probeChunkedWire(api, fixtures);
    const positive = baseline.code === 'accepted' && baseline.known_bytes && baseline.allowed_connections === 1 && baseline.allowed_requests === 1;
    const denied = rejected.every(row => row.code === 'POLICY_DENIED' && row.protected_connections === 0 && row.protected_requests === 0);
    const redirected = rejected.find(row => row.id === 'redirect-private');
    return { counters, rows, parser_rows, limits, chunked_wire,
      boundary_surface: 'SafeFetcher.fetch; parser_rows are separate unit observations.',
      observations: {
        private_targets_reached: counters.protected_connections,
        redirects_checked: positive && denied && redirected.allowed_requests === 1 && loop.code === 'REDIRECT_LIMIT'
          && loop.allowed_requests === limits.redirectsPerFetch + 1,
        resource_limits_enforced: positive && wire.code === 'RESOURCE_LIMIT' && wire.allowed_requests === 1
          && decoded.code === 'RESOURCE_LIMIT' && decoded.allowed_requests === 1
          && rows.filter(row => row.id.startsWith('request-') && row.id !== 'request-limit').every(row => row.code === 'accepted' && row.known_bytes)
          && exhausted.code === 'REQUEST_LIMIT' && exhausted.allowed_connections === 0 && chunked_wire.passed,
      },
      capture_scope: 'Main counters cover the original two task-local loopback servers; chunked_wire records its dedicated fixtures separately. No external egress telemetry.',
      uncovered: ['DNS wire/rebinding/CNAME/mixed-answer behavior', 'deadline and concurrency limits',
        'gzip encoded-body and aggregate decoded-byte limits',
        'TLS and production networking', 'image/PDF intake and downstream parsers',
        'research/JEV/creative rejection handoff', 'authoritative external egress capture'],
    };
  } finally {
    if (allowed) await allowed.close();
    await protectedServer.close();
  }
}
