import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const payload = Buffer.from('controlled resolver redirect bytes');

export async function probeResolverInputs(api, fixtures) {
  const { SafeFetcher, RetrievalError } = api;
  const safe = { addresses: ['127.0.0.1'], aliases: ['resolver-safe.example.org'] };
  const scenarios = [
    ['safe-alias', safe, 'accepted'],
    ['private-transition', { addresses: ['10.0.0.7'], aliases: [] }, 'POLICY_DENIED'],
    ['mixed-answers', { addresses: ['127.0.0.1', '10.0.0.7'], aliases: [] }, 'POLICY_DENIED'],
    ['metadata-alias', { addresses: ['127.0.0.1'], aliases: ['metadata.google.internal'] }, 'POLICY_DENIED'],
    ['ip-alias', { addresses: ['127.0.0.1'], aliases: ['8.8.8.8'] }, 'DNS_FAILURE'],
  ];
  const rows = [];
  for (const [id, secondAnswer, expectedCode] of scenarios) {
    let connections = 0, redirectRequests = 0, finalRequests = 0;
    let responseCloses = 0, connectionCloses = 0;
    const closures = [], resolverCalls = [];
    const fixture = await fixtures.startFixture((request, response) => {
      response.once('close', () => responseCloses++);
      if (request.url === '/start') {
        redirectRequests++;
        response.writeHead(302, { location: '/final' });
        response.end();
      } else {
        finalRequests++;
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(payload);
      }
    });
    fixture.server.on('connection', socket => {
      connections++;
      closures.push(new Promise(resolve => {
        socket.once('close', () => { connectionCloses++; resolve(); });
      }));
    });
    try {
      const seam = fixtures.localTestSeam({ port: fixture.port,
        resolveOverride(hostname) {
          const initial = resolverCalls.length === 0;
          const answer = initial ? safe : secondAnswer;
          resolverCalls.push({ input_profile: initial ? 'safe' : id,
            same_hostname: hostname === 'fixture.example.test',
            address_count: answer.addresses.length, alias_count: answer.aliases.length });
          return Object.freeze({ addresses: Object.freeze([...answer.addresses]),
            aliases: Object.freeze([...answer.aliases]) });
        },
      });
      let code = 'accepted', returnedBytes = null, returnedHash = null;
      try {
        const result = await new SafeFetcher(seam).fetch(fixtures.fixtureUrl(fixture.port, '/start'));
        returnedBytes = result.bytes.byteLength;
        returnedHash = hash(result.bytes);
      } catch (error) {
        if (!(error instanceof RetrievalError)) throw error;
        code = error.code;
      }
      await Promise.all(closures);
      const expectedRequests = expectedCode === 'accepted' ? 2 : 1;
      const passed = code === expectedCode && resolverCalls.length === 2
        && resolverCalls.every(call => call.same_hostname)
        && redirectRequests === 1 && finalRequests === expectedRequests - 1
        && connections === expectedRequests && responseCloses === expectedRequests
        && connectionCloses === expectedRequests
        && (expectedCode === 'accepted'
          ? returnedBytes === payload.length && returnedHash === hash(payload)
          : returnedBytes === null && returnedHash === null);
      rows.push({ id, code, resolver_calls: resolverCalls, connections,
        redirect_requests: redirectRequests, final_requests: finalRequests,
        response_closes: responseCloses, connection_closes: connectionCloses,
        returned_bytes: returnedBytes, returned_sha256: returnedHash, passed });
    } finally {
      await fixture.close();
    }
  }
  return { fixture_mode: 'source-only-localTestSeam-resolveOverride', rows,
    passed: rows.every(row => row.passed),
    capture_scope: 'Injected resolver metadata on a same-host relative redirect; dedicated task-local HTTP/TCP counters and natural closure before cleanup. No wire DNS, TTL rebinding, CNAME following, TLS or external egress capture.',
  };
}
