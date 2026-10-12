import { createHash, X509Certificate } from 'node:crypto';
import { probeHandshakeDeadline } from './retrieval_handshake.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const body = Buffer.from('controlled TLS redirect bytes');

async function redirectAttempt(api, fixtures, certificates, id) {
  const [trusted, other] = certificates;
  let connections = 0, socketCloses = 0, initialRequests = 0, finalRequests = 0;
  let secureConnections = 0, tlsErrors = 0, responseCloses = 0, rotated = false;
  const closures = [], servedCertificates = [], events = [];
  const fixture = await fixtures.startFixture((request, response) => {
    response.once('close', () => responseCloses++);
    if (request.url === '/start') {
      initialRequests++; events.push('initial-http');
      if (id === 'trust-mismatch') {
        fixture.server.setSecureContext({ key: other.key, cert: other.cert, minVersion: 'TLSv1.2' });
        rotated = true; events.push('rotate-certificate');
      }
      const location = id === 'hostname-mismatch'
        ? fixtures.fixtureUrl(fixture.port, '/final', 'mismatch.fixture.example.test', 'https:') : '/final';
      response.writeHead(302, { location });
      response.end();
    } else {
      finalRequests++; events.push('final-http');
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(body);
    }
  }, { certificate: trusted });
  fixture.server.on('connection', socket => {
    connections++; events.push('tcp');
    closures.push(new Promise(resolve => {
      socket.once('close', () => { socketCloses++; events.push('socket-close'); resolve(); });
    }));
  });
  fixture.server.on('secureConnection', socket => {
    secureConnections++; events.push('tls-secure');
    const raw = socket.getCertificate()?.raw;
    servedCertificates.push(raw ? hash(raw) : null);
  });
  fixture.server.on('tlsClientError', () => { tlsErrors++; events.push('tls-client-error'); });
  try {
    const seam = fixtures.localTestSeam({ port: fixture.port, certificate: trusted,
      hostnames: ['fixture.example.test', 'mismatch.fixture.example.test'] });
    let code = 'accepted', returnedBytes = null, returnedHash = null;
    try {
      const result = await new api.SafeFetcher(seam).fetch(
        fixtures.fixtureUrl(fixture.port, '/start', 'fixture.example.test', 'https:'));
      returnedBytes = result.bytes.byteLength;
      returnedHash = hash(result.bytes);
    } catch (error) {
      if (!(error instanceof api.RetrievalError)) throw error;
      code = error.code;
    }
    await Promise.all(closures);
    const positive = id === 'trusted';
    const passed = connections === 2 && socketCloses === 2 && initialRequests === 1
      && finalRequests === (positive ? 1 : 0) && responseCloses === initialRequests + finalRequests
      && (positive ? code === 'accepted' && returnedBytes === body.length && returnedHash === hash(body)
        : code === 'TRANSPORT_FAILURE' && returnedBytes === null && returnedHash === null);
    return { id, code, connections, socket_closes: socketCloses,
      initial_requests: initialRequests, final_requests: finalRequests, response_closes: responseCloses,
      secure_connections: secureConnections, tls_client_errors: tlsErrors,
      served_certificate_sha256: servedCertificates, events, rotated,
      returned_bytes: returnedBytes, returned_sha256: returnedHash, passed };
  } finally { await fixture.close(); }
}

export async function probeTls(api, fixtures) {
  const trusted = await fixtures.createCertificate();
  let other;
  try {
    other = await fixtures.createCertificate();
    const trustedDigest = hash(new X509Certificate(trusted.cert).raw);
    const otherDigest = hash(new X509Certificate(other.cert).raw);
    const rows = [];
    for (const id of ['trusted', 'hostname-mismatch', 'trust-mismatch']) {
      rows.push(await redirectAttempt(api, fixtures, [trusted, other], id));
    }
    const handshake_deadline = await probeHandshakeDeadline(api, fixtures, trusted);
    return { tls_redirects: {
      fixture_mode: 'source-only-owner-createCertificate-localTestSeam',
      trusted_certificate_sha256: trustedDigest, other_certificate_sha256: otherDigest,
      rows, passed: trustedDigest !== otherDigest && rows.every(row => row.passed),
      capture_scope: 'Owner certificates generated in task TMPDIR; public DER digests only. Dedicated HTTPS redirect fixtures count TCP, server TLS events, initial/final HTTP and natural closures. Server secureConnection is not client trust. No system trust, public DNS/CA or external egress claim.',
    }, handshake_deadline };
  } finally {
    try { if (other) await other.close(); }
    finally { await trusted.close(); }
  }
}
