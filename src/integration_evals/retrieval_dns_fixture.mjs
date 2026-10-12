import { createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';

export const DNS_HOST = 'wire-target.example.org';
const names = { target: DNS_HOST, alias: 'alias.example.org', forbidden: 'private.internal' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frame = bytes => {
  const size = Buffer.alloc(2); size.writeUInt16BE(bytes.length);
  return Buffer.concat([size, bytes]);
};
const encodeName = name => Buffer.concat([
  ...name.split('.').flatMap(label => [Buffer.from([label.length]), Buffer.from(label, 'ascii')]), Buffer.from([0]),
]);

function question(packet) {
  if (packet.length < 17 || packet.length > 512 || packet.readUInt16BE(2) !== 0x0100
    || packet.readUInt16BE(4) !== 1 || packet.readUInt32BE(6) !== 0 || packet.readUInt16BE(10) !== 0) return null;
  let offset = 12;
  const labels = [];
  while (offset < packet.length && packet[offset] !== 0) {
    const size = packet[offset++];
    if (size > 63 || offset + size >= packet.length) return null;
    labels.push(packet.subarray(offset, offset + size).toString('ascii')); offset += size;
  }
  if (offset + 5 !== packet.length) return null;
  const hostname = labels.join('.'), type = packet.readUInt16BE(offset + 1), qclass = packet.readUInt16BE(offset + 3);
  const profile = Object.keys(names).find(key => names[key] === hostname);
  if (!profile || ![1, 28].includes(type) || qclass !== 1) return null;
  return { profile, type, qclass, id: packet.readUInt16BE(0) };
}

function response(packet, query, scenario, transport) {
  const truncated = transport === 'udp' && ['tcp-public', 'wrong-tcp-id'].includes(scenario);
  const payloads = [];
  let recordType = 1;
  if (!truncated && query.type === 1) {
    if (query.profile === 'target' && ['udp-cname', 'forbidden-cname'].includes(scenario)) {
      recordType = 5;
      payloads.push(encodeName(scenario === 'udp-cname' ? names.alias : names.forbidden));
    } else if (scenario === 'private-answer') payloads.push(Buffer.from([10, 0, 0, 7]));
    else if (scenario === 'mixed-answer') payloads.push(Buffer.from([8, 8, 8, 8]), Buffer.from([10, 0, 0, 7]));
    else payloads.push(Buffer.from(['tcp-public', 'wrong-tcp-id'].includes(scenario) ? [9, 9, 9, 9] : [8, 8, 8, 8]));
  }
  const header = Buffer.alloc(12);
  const corrupt = scenario === 'wrong-tcp-id' && transport === 'tcp' && query.type === 1;
  header.writeUInt16BE(corrupt ? (query.id + 1) & 0xffff : query.id, 0);
  header.writeUInt16BE(truncated ? 0x8380 : 0x8180, 2);
  header.writeUInt16BE(1, 4); header.writeUInt16BE(payloads.length, 6);
  const records = payloads.map(payload => {
    const record = Buffer.alloc(12);
    record.writeUInt16BE(0xc00c, 0); record.writeUInt16BE(recordType, 2);
    record.writeUInt16BE(1, 4); record.writeUInt32BE(60, 6); record.writeUInt16BE(payload.length, 10);
    return Buffer.concat([record, payload]);
  });
  return Buffer.concat([header, packet.subarray(12), ...records]);
}

export async function startDnsFixture(scenario) {
  const udp = createSocket('udp4'), sockets = new Set(), closures = [], sends = [];
  const queries = [], events = [], unexpected = [], transactions = [], originals = new Map(), pending = { udp: [], tcp: [] };
  let tcpConnections = 0, tcpCloses = 0, socketErrors = 0, protocolErrors = 0;
  const emit = (event, transport, index = null) => events.push({ event, transport, query_index: index });
  const receive = (packet, transport, peer, send, peerClosed = Promise.resolve()) => {
    const parsed = question(packet);
    if (!parsed || queries.length >= 16) {
      protocolErrors++;
      unexpected.push({ transport, bytes: packet.length, sha256: hash(packet) });
      const invalid = Buffer.alloc(12);
      packet.copy(invalid, 0, 0, Math.min(2, packet.length)); invalid.writeUInt16BE(0x8181, 2);
      send(invalid, () => {});
      return;
    }
    const index = queries.length;
    const row = { index, transport, question_profile: parsed.profile, id: parsed.id,
      type: parsed.type, qclass: parsed.qclass, peer_loopback: peer.address === '127.0.0.1', peer_source_port: peer.port,
      query_bytes: packet.length, query_sha256: hash(packet), question_sha256: hash(packet.subarray(12)),
      query_frame_sha256: hash(transport === 'tcp' ? frame(packet) : packet),
      reply_id: null, reply_flags: null, reply_bytes: null, reply_sha256: null,
      reply_frame_sha256: null, send_completed: null,
      fallback_frame_matches_udp: transport === 'tcp'
        ? originals.has(parsed.type) && frame(originals.get(parsed.type)).equals(frame(packet)) : null };
    if (transport === 'udp' && parsed.profile === 'target') originals.set(parsed.type, Buffer.from(packet));
    queries.push(row); emit('query', transport, index);
    const dispatch = () => {
      const reply = response(packet, parsed, scenario, transport);
      row.reply_id = reply.readUInt16BE(0); row.reply_flags = reply.readUInt16BE(2);
      row.reply_bytes = reply.length; row.reply_sha256 = hash(reply);
      row.reply_frame_sha256 = hash(transport === 'tcp' ? frame(reply) : reply);
      emit('reply-dispatched', transport, index);
      const sent = new Promise(resolve => send(reply, error => {
        row.send_completed = !error;
        emit(error ? 'send-error' : 'send-completed', transport, index); resolve();
      }));
      sends.push(sent); return sent;
    };
    if (parsed.profile !== 'target') { dispatch(); return; }
    const gate = pending[transport];
    gate.push({ type: parsed.type, dispatch, peerClosed });
    if (gate.length === 2 && new Set(gate.map(item => item.type)).size === 2) {
      transactions.push((async () => {
        for (const item of [...gate].sort((left, right) => right.type - left.type)) {
          await item.dispatch();
          if (transport === 'tcp') await item.peerClosed;
        }
      })());
    } else if (gate.length > 1) {
      protocolErrors++;
      dispatch();
    }
  };
  const tcp = createServer(socket => {
    tcpConnections++; sockets.add(socket); emit('tcp-open', 'tcp');
    socket.on('error', () => socketErrors++);
    const peerClosed = new Promise(resolve => socket.once('close', () => {
      tcpCloses++; sockets.delete(socket); emit('tcp-close', 'tcp'); resolve();
    }));
    closures.push(peerClosed);
    let buffer = Buffer.alloc(0), handled = false;
    socket.on('data', chunk => {
      if (handled || buffer.length + chunk.length > 514) { protocolErrors++; socket.destroy(); return; }
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 2) return;
      const size = buffer.readUInt16BE(0);
      if (size < 17 || size > 512 || buffer.length > size + 2) { protocolErrors++; socket.destroy(); return; }
      if (buffer.length !== size + 2) return;
      handled = true;
      receive(buffer.subarray(2), 'tcp', { address: socket.remoteAddress, port: socket.remotePort },
        (reply, done) => socket.end(frame(reply), done), peerClosed);
    });
  });
  udp.on('error', () => socketErrors++);
  try {
    await new Promise((resolve, reject) => { tcp.once('error', reject); tcp.listen(0, '127.0.0.1', resolve); });
    const { port } = tcp.address();
    await new Promise((resolve, reject) => { udp.once('error', reject); udp.bind(port, '127.0.0.1', resolve); });
    udp.on('message', (packet, peer) => receive(packet, 'udp', peer,
      (reply, done) => udp.send(reply, peer.port, peer.address, done)));
    return {
      port,
      async capture() {
        await Promise.all(transactions); await Promise.all(sends); await Promise.all(closures);
        return { server_port: port, queries, events, unexpected_packets: unexpected, protocol_errors: protocolErrors,
          socket_errors: socketErrors, tcp_connections: tcpConnections, tcp_closes: tcpCloses };
      },
      async close() {
        for (const socket of sockets) socket.destroy();
        await Promise.all([new Promise(resolve => udp.close(resolve)), new Promise(resolve => tcp.close(resolve))]);
      },
    };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    try { udp.close(); } catch (closeError) { if (closeError.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw closeError; }
    await new Promise(resolve => tcp.close(resolve));
    throw error;
  }
}
