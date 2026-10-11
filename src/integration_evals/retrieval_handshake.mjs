import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';

export async function probeHandshakeDeadline(api, fixtures, certificate) {
  let connections = 0, socketCloses = 0, received = 0, sent = 0, socketErrors = 0;
  let connectedAt = null, firstBytesAt = null, closedAt = null, started;
  const sockets = new Set(), closures = [];
  const server = createServer(socket => {
    connections++;
    connectedAt ??= performance.now() - started;
    sockets.add(socket);
    socket.on('data', bytes => {
      received += bytes.length;
      firstBytesAt ??= performance.now() - started;
    });
    socket.on('error', () => socketErrors++);
    closures.push(new Promise(resolve => {
      socket.once('close', () => {
        sent += socket.bytesWritten;
        socketCloses++;
        closedAt = performance.now() - started;
        sockets.delete(socket);
        resolve();
      });
    }));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    const fetcher = new api.SafeFetcher(fixtures.localTestSeam({ port, certificate }));
    let code = 'accepted', returnedBytes = null;
    started = performance.now();
    try {
      const result = await fetcher.fetch(fixtures.fixtureUrl(port, '/', 'fixture.example.test', 'https:'));
      returnedBytes = result.bytes.byteLength;
    } catch (error) {
      if (!(error instanceof api.RetrievalError)) throw error;
      code = error.code;
    }
    const outcomeElapsed = performance.now() - started;
    await Promise.all(closures);
    const reached = connections === 1 && received > 0;
    return { fixture_mode: 'source-only-localTestSeam-raw-tcp', code, returned_bytes: returnedBytes,
      connect_milliseconds: api.DEFAULT_RUN_LIMITS.connectMilliseconds,
      total_milliseconds: api.DEFAULT_RUN_LIMITS.totalMilliseconds,
      window_min_ms: 9900, window_max_ms: 20000,
      connections, socket_closes: socketCloses, socket_errors: socketErrors,
      received_bytes: received, sent_bytes: sent, stage_reached: reached,
      connected_at_ms: connectedAt, first_client_bytes_at_ms: firstBytesAt,
      outcome_elapsed_ms: outcomeElapsed, peer_closed_at_ms: closedAt,
      passed: reached && socketCloses === 1 && sent === 0 && code === 'DEADLINE_EXCEEDED'
        && returnedBytes === null && outcomeElapsed >= 9900 && outcomeElapsed <= 20000
        && connectedAt <= firstBytesAt && firstBytesAt < outcomeElapsed,
      capture_scope: 'Raw task-local TCP listener consumes client bytes and sends none; no TLS/HTTP parser or handshake-success telemetry. Real monotonic times, natural closure before cleanup; nominal connect/handshake timer only, not overall deadline.',
    };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}
