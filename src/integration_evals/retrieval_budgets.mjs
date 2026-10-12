import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gzipFixture = (size, level) => {
  const body = Buffer.alloc(size, 98);
  const encoded = gzipSync(body, { level });
  return { encoded, encoded_bytes: encoded.length, encoded_sha256: hash(encoded),
    decoded_bytes: body.length, decoded_sha256: hash(body), gzip_level: level };
};

export async function probeByteBudgets(api, fixtures) {
  const { SafeFetcher, RetrievalError, DEFAULT_RUN_LIMITS: limits } = api;
  const data = {
    '/positive': gzipFixture(1024, 6),
    '/wire': gzipFixture(limits.wireBytesPerRequest + 1, 0),
    '/full': gzipFixture(limits.decodedTextBytesPerRequest, 6),
    '/one': gzipFixture(1, 6),
  };
  let connections = 0, requests = 0, responseCloses = 0, connectionCloses = 0;
  let chunked = null, gzip = null, contentLengthPresent = null;
  const closures = [], rows = [];
  const fixture = await fixtures.startFixture((request, response) => {
    requests++;
    response.setHeader('content-type', 'text/plain');
    response.setHeader('content-encoding', 'gzip');
    response.setHeader('transfer-encoding', 'chunked');
    response.writeHead(200);
    response.flushHeaders();
    chunked = response.getHeader('transfer-encoding') === 'chunked';
    gzip = response.getHeader('content-encoding') === 'gzip';
    contentLengthPresent = response.hasHeader('content-length');
    response.once('close', () => responseCloses++);
    response.end(data[request.url].encoded);
  });
  fixture.server.on('connection', socket => {
    connections++;
    closures.push(new Promise(resolve => {
      socket.once('close', () => { connectionCloses++; resolve(); });
    }));
  });
  try {
    const seam = fixtures.localTestSeam({ port: fixture.port });
    const measure = async (id, fetcher, route, fetcherScope, acceptedBefore) => {
      const before = { connections, requests, responseCloses, connectionCloses };
      chunked = gzip = contentLengthPresent = null;
      let code = 'accepted', returnedBytes = null, returnedHash = null;
      try {
        const result = await fetcher.fetch(fixtures.fixtureUrl(fixture.port, route));
        returnedBytes = result.bytes.byteLength;
        returnedHash = hash(result.bytes);
      } catch (error) {
        if (!(error instanceof RetrievalError)) throw error;
        code = error.code;
      }
      await Promise.all(closures.slice(before.connections));
      const { encoded, ...metadata } = data[route];
      const row = { id, code, ...metadata, fetcher_scope: fetcherScope,
        accepted_decoded_before: acceptedBefore, returned_bytes: returnedBytes, returned_sha256: returnedHash,
        connections: connections - before.connections, requests: requests - before.requests,
        response_closes: responseCloses - before.responseCloses,
        connection_closes: connectionCloses - before.connectionCloses,
        transfer_chunked: chunked, content_gzip: gzip, content_length_present: contentLengthPresent };
      rows.push(row);
      return row;
    };
    const positive = await measure('gzip-positive', new SafeFetcher(seam), '/positive', 'fresh', 0);
    const wire = await measure('gzip-wire-overflow', new SafeFetcher(seam), '/wire', 'fresh', 0);
    const shared = new SafeFetcher(seam), aggregate = [];
    let accepted = 0;
    for (let index = 0; index < limits.decodedBytesPerRun / limits.decodedTextBytesPerRequest; index++) {
      const row = await measure(`aggregate-${index + 1}`, shared, '/full', 'shared-aggregate', accepted);
      accepted += row.returned_bytes ?? 0;
      aggregate.push(row);
    }
    const overflow = await measure('aggregate-overflow', shared, '/one', 'shared-aggregate', accepted);
    const fresh = await measure('fresh-one-byte', new SafeFetcher(seam), '/one', 'fresh', 0);
    const transported = row => row.connections === 1 && row.requests === 1
      && row.response_closes === 1 && row.connection_closes === 1
      && row.transfer_chunked === true && row.content_gzip === true && row.content_length_present === false;
    const acceptedBody = row => row.code === 'accepted' && row.returned_bytes === row.decoded_bytes
      && row.returned_sha256 === row.decoded_sha256;
    const rejected = row => row.code === 'RESOURCE_LIMIT' && row.returned_bytes === null && row.returned_sha256 === null;
    const isolated = wire.encoded_bytes > limits.wireBytesPerRequest
      && wire.decoded_bytes < limits.decodedTextBytesPerRequest && wire.decoded_bytes < limits.decodedBytesPerRun
      && aggregate.length + 1 < limits.requests
      && [...aggregate, overflow, fresh].every(row => row.encoded_bytes < limits.wireBytesPerRequest
        && row.decoded_bytes <= limits.decodedTextBytesPerRequest);
    return { fixture_mode: 'source-only-localTestSeam',
      wire_bytes_per_request: limits.wireBytesPerRequest, decoded_text_bytes_per_request: limits.decodedTextBytesPerRequest,
      decoded_bytes_per_run: limits.decodedBytesPerRun, requests_per_run: limits.requests,
      rows, passed: isolated && rows.every(transported) && acceptedBody(positive) && rejected(wire)
        && aggregate.every(acceptedBody) && accepted === limits.decodedBytesPerRun
        && rejected(overflow) && acceptedBody(fresh),
      capture_scope: 'Task-local gzip fixture; per-request HTTP/TCP and natural closure before cleanup. Encoded gzip body bytes exclude HTTP framing. accepted_decoded_before sums returned bodies, not private fetcher state; no external egress telemetry.',
    };
  } finally {
    await fixture.close();
  }
}
