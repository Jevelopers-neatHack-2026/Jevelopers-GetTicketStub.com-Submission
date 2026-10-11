import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function probeChunkedWire(api, fixtures) {
  const { SafeFetcher, RetrievalError, DEFAULT_RUN_LIMITS: limits } = api;
  const measure = async (id, size) => {
    const payload = Buffer.alloc(size, 98);
    const expectedHash = hash(payload);
    let connections = 0, requests = 0, responseCloses = 0, connectionCloses = 0;
    let chunked = null, identity = null, contentLengthPresent = null;
    let resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });
    const fixture = await fixtures.startFixture((_request, response) => {
      requests++;
      response.setHeader('content-type', 'text/plain');
      response.setHeader('content-encoding', 'identity');
      response.setHeader('transfer-encoding', 'chunked');
      response.writeHead(200);
      response.flushHeaders();
      chunked = response.getHeader('transfer-encoding') === 'chunked';
      identity = response.getHeader('content-encoding') === 'identity';
      contentLengthPresent = response.hasHeader('content-length');
      response.once('close', () => responseCloses++);
      response.end(payload);
    });
    fixture.server.on('connection', socket => {
      connections++;
      socket.once('close', () => { connectionCloses++; resolveClosed(); });
    });
    try {
      let code = 'accepted', returnedBytes = null, returnedHash = null;
      try {
        const fetcher = new SafeFetcher(fixtures.localTestSeam({ port: fixture.port }));
        const result = await fetcher.fetch(fixtures.fixtureUrl(fixture.port));
        returnedBytes = result.bytes.byteLength;
        returnedHash = hash(result.bytes);
      } catch (error) {
        if (!(error instanceof RetrievalError)) throw error;
        code = error.code;
      }
      if (connections > 0) await closed;
      return { id, code, fixture_bytes: size, fixture_sha256: expectedHash,
        returned_bytes: returnedBytes, returned_sha256: returnedHash,
        connections, requests, response_closes: responseCloses, connection_closes: connectionCloses,
        transfer_chunked: chunked, content_identity: identity, content_length_present: contentLengthPresent };
    } finally {
      await fixture.close();
    }
  };
  const atLimit = await measure('at-limit', limits.wireBytesPerRequest);
  const overLimit = await measure('over-limit', limits.wireBytesPerRequest + 1);
  const reachedAndClosed = row => row.connections === 1 && row.requests === 1
    && row.response_closes === 1 && row.connection_closes === 1
    && row.transfer_chunked === true && row.content_identity === true && row.content_length_present === false;
  const isolatedLimit = overLimit.fixture_bytes <= limits.decodedTextBytesPerRequest
    && overLimit.fixture_bytes <= limits.decodedBytesPerRun && limits.requests >= 1;
  return {
    fixture_mode: 'source-only-localTestSeam',
    wire_bytes_per_request: limits.wireBytesPerRequest,
    decoded_text_bytes_per_request: limits.decodedTextBytesPerRequest,
    decoded_bytes_per_run: limits.decodedBytesPerRun,
    fresh_fetcher_per_request: true,
    rows: [atLimit, overLimit],
    passed: isolatedLimit && reachedAndClosed(atLimit) && reachedAndClosed(overLimit)
      && atLimit.code === 'accepted' && atLimit.returned_bytes === atLimit.fixture_bytes
      && atLimit.returned_sha256 === atLimit.fixture_sha256
      && overLimit.code === 'RESOURCE_LIMIT' && overLimit.returned_bytes === null,
    capture_scope: 'Dedicated task-local fixture servers; closure observed before forced fixture cleanup. Encoded identity-body bytes exclude HTTP framing; no external egress measurement.',
  };
}
