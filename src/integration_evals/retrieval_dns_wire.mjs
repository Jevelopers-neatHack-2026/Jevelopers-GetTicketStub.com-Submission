import { createHash } from 'node:crypto';
import { DNS_HOST, startDnsFixture } from './retrieval_dns_fixture.mjs';

const resultHash = result => createHash('sha256').update(JSON.stringify(result)).digest('hex');

function tracePassed(wire, id) {
  const fallback = ['tcp-public', 'wrong-tcp-id'].includes(id);
  const transports = fallback ? ['udp', 'tcp'] : ['udp'];
  const aliases = wire.queries.filter(row => row.question_profile !== 'target');
  if (wire.protocol_errors !== 0 || wire.socket_errors !== 0 || wire.unexpected_packets.length !== 0
    || wire.tcp_connections !== (fallback ? 2 : 0) || wire.tcp_closes !== wire.tcp_connections
    || aliases.length !== (id === 'udp-cname' ? 1 : 0)) return false;
  if (aliases.some(row => row.transport !== 'udp' || row.question_profile !== 'alias' || row.type !== 1)) return false;
  for (const transport of transports) {
    const root = wire.queries.filter(row => row.transport === transport && row.question_profile === 'target');
    if (root.length !== 2 || root.map(row => row.type).sort((a, b) => a - b).join(',') !== '1,28') return false;
    const arrivals = root.map(row => wire.events.findIndex(event => event.event === 'query' && event.query_index === row.index));
    const replies = root.map(row => wire.events.findIndex(event => event.event === 'reply-dispatched' && event.query_index === row.index));
    if (Math.min(...arrivals) < 0 || Math.min(...replies) <= Math.max(...arrivals)) return false;
  }
  if (wire.queries.length !== (fallback ? 4 : id === 'udp-cname' ? 3 : 2)) return false;
  for (const row of wire.queries) {
    const flags = row.transport === 'udp' && fallback ? 0x8380 : 0x8180;
    const corrupt = id === 'wrong-tcp-id' && row.transport === 'tcp' && row.type === 1;
    if (!row.peer_loopback || !Number.isInteger(row.peer_source_port) || row.peer_source_port < 1
      || row.peer_source_port > 65535 || row.qclass !== 1 || row.send_completed !== true
      || row.reply_flags !== flags || row.reply_id !== (corrupt ? (row.id + 1) & 0xffff : row.id)) return false;
    if (row.transport === 'tcp') {
      const udp = wire.queries.find(query => query.transport === 'udp' && query.question_profile === row.question_profile && query.type === row.type);
      if (!row.fallback_frame_matches_udp || !udp || row.id !== udp.id
        || row.query_sha256 !== udp.query_sha256 || row.question_sha256 !== udp.question_sha256) return false;
    }
  }
  if (aliases.length) {
    const parent = wire.queries.find(row => row.question_profile === 'target' && row.type === 1);
    const dispatched = wire.events.findIndex(event => event.event === 'reply-dispatched' && event.query_index === parent.index);
    const arrived = wire.events.findIndex(event => event.event === 'query' && event.query_index === aliases[0].index);
    if (arrived <= dispatched) return false;
  }
  return true;
}

async function scenario(api, fixtures, id) {
  const dns = await startDnsFixture(id);
  const resolver = new fixtures.DnsWireResolver({ nameservers: ['127.0.0.1'], port: dns.port });
  const positive = ['udp-cname', 'tcp-public'].includes(id);
  let resolverCode = 'not-invoked', digest = null, resolverCalls = 0, controlStop = false, fetchCode = null;
  let returnedBytes = null, returnedHash = null;
  let connections = 0, initial = 0, final = 0, responseCloses = 0, socketCloses = 0;
  const httpClosures = [], order = [];
  let http;
  const resolve = async (hostname, options) => {
    resolverCalls++; order.push('wire-invoked');
    try {
      const result = await resolver.resolve(hostname, options);
      resolverCode = 'accepted'; digest = resultHash(result); order.push('wire-accepted');
      return result;
    } catch (error) {
      if (!(error instanceof api.RetrievalError)) throw error;
      resolverCode = error.code; order.push('wire-rejected'); throw error;
    }
  };
  try {
    if (positive) {
      try { await resolve(DNS_HOST); }
      catch (error) { if (!(error instanceof api.RetrievalError)) throw error; }
    } else {
      http = await fixtures.startFixture((request, response) => {
        response.once('close', () => responseCloses++);
        if (request.url === '/start') {
          initial++; order.push('initial-http');
          response.writeHead(302, { location: fixtures.fixtureUrl(http.port, '/final', DNS_HOST) });
          response.end();
        } else {
          final++; order.push('final-http'); response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('controlled DNS redirect bytes');
        }
      });
      http.server.on('connection', socket => {
        connections++;
        httpClosures.push(new Promise(done => socket.once('close', () => { socketCloses++; done(); })));
      });
      const seam = fixtures.localTestSeam({ port: http.port, hostnames: ['fixture.example.test', DNS_HOST],
        async resolveOverride(hostname, options) {
          if (hostname === 'fixture.example.test') return Object.freeze({ addresses: Object.freeze(['127.0.0.1']), aliases: Object.freeze([]) });
          await resolve(hostname, options);
          controlStop = true; order.push('control-stop');
          throw new api.RetrievalError('POLICY_DENIED');
        },
      });
      try {
        const result = await new api.SafeFetcher(seam).fetch(fixtures.fixtureUrl(http.port, '/start'));
        fetchCode = 'accepted';
        returnedBytes = result.bytes.byteLength;
        returnedHash = createHash('sha256').update(result.bytes).digest('hex');
      } catch (error) {
        if (!(error instanceof api.RetrievalError)) throw error;
        fetchCode = error.code;
      }
      await Promise.all(httpClosures);
    }
    const wire = await dns.capture();
    const expectedCode = positive ? 'accepted' : id === 'wrong-tcp-id' ? 'DNS_FAILURE' : 'POLICY_DENIED';
    const expectedResult = id === 'udp-cname'
      ? { addresses: ['8.8.8.8'], aliases: ['alias.example.org'] }
      : { addresses: ['9.9.9.9'], aliases: [] };
    const passed = resolverCalls === 1 && resolverCode === expectedCode && !controlStop
      && tracePassed(wire, id)
      && (positive ? digest === resultHash(expectedResult) && connections === 0
        : fetchCode === expectedCode && connections === 1 && initial === 1 && final === 0
          && responseCloses === 1 && socketCloses === 1
          && order.indexOf('initial-http') >= 0 && order.indexOf('initial-http') < order.indexOf('wire-invoked'));
    return { id, surface: positive ? 'resolver-only' : 'http-redirect-negative',
      resolver_calls: resolverCalls, resolver_code: resolverCode, resolver_result_sha256: digest,
      fetch_code: fetchCode, control_stop: controlStop,
      control_stop_code: controlStop ? 'POLICY_DENIED' : null,
      control_stop_provenance: controlStop ? 'negative-fixture-unconditional-stop-before-transport' : null,
      http_connections: connections, initial_http: initial, final_http: final,
      http_returned_bytes: returnedBytes, http_returned_sha256: returnedHash,
      http_response_closes: responseCloses, http_socket_closes: socketCloses, order, wire, passed };
  } finally {
    try { if (http) await http.close(); }
    finally { await dns.close(); }
  }
}

export async function probeDnsWire(api, fixtures) {
  const rows = [];
  for (const id of ['udp-cname', 'tcp-public', 'private-answer', 'mixed-answer', 'forbidden-cname', 'wrong-tcp-id']) {
    rows.push(await scenario(api, fixtures, id));
  }
  return { fixture_mode: 'source-only-internal-DnsWireResolver', rows, passed: rows.every(row => row.passed),
    capture_scope: 'Actual owner internal resolver against task-local UDP/TCP packet fixtures. Public-answer positives are resolver-only; negative redirects stop every unexpected result before HTTP transport and label that stop separately. Query/reply hashes and IDs are observed; no UDP peer-close telemetry, system DNS, TTL/race, public transport or authoritative egress claim.',
  };
}
