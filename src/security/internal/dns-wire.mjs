import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSocket } from "node:dgram";
import { connect as connectStream } from "node:net";
import { isIP } from "node:net";
import { isPublicAddress, sameAddress, validateHostname } from "../url-policy.mjs";
import { RetrievalError } from "../errors.mjs";

const TYPE_A = 1;
const TYPE_CNAME = 5;
const TYPE_AAAA = 28;
const DNS_CLASS_IN = 1;
const MAX_PACKET = 65_535;
const MAX_CNAME_HOPS = 8;

function remaining(deadline) {
  const milliseconds = deadline - performance.now();
  if (milliseconds <= 0) throw new RetrievalError("DEADLINE_EXCEEDED");
  return milliseconds;
}

function ensureActive(signal, deadline) {
  if (signal?.aborted) throw new RetrievalError("CANCELED");
  if (performance.now() >= deadline) throw new RetrievalError("DEADLINE_EXCEEDED");
}

function queryPacket(hostname, type, id) {
  const labels = hostname.split(".");
  const encoded = [];
  for (const label of labels) {
    const bytes = Buffer.from(label, "ascii");
    if (!bytes.length || bytes.length > 63 || bytes.toString("ascii") !== label) throw new RetrievalError("DNS_FAILURE");
    encoded.push(Buffer.from([bytes.length]), bytes);
  }
  encoded.push(Buffer.from([0]));
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // recursion desired
  header.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(DNS_CLASS_IN, 2);
  return Buffer.concat([header, ...encoded, tail]);
}

function decodeName(packet, offset) {
  const labels = [];
  let cursor = offset;
  let resume = null;
  const seen = new Set();
  for (let hops = 0; hops < 64; hops += 1) {
    if (cursor >= packet.length) throw new RetrievalError("DNS_FAILURE");
    const length = packet[cursor];
    if ((length & 0xc0) === 0xc0) {
      if (cursor + 1 >= packet.length) throw new RetrievalError("DNS_FAILURE");
      const pointer = ((length & 0x3f) << 8) | packet[cursor + 1];
      if (pointer >= cursor || pointer >= packet.length || seen.has(pointer)) throw new RetrievalError("DNS_FAILURE");
      seen.add(pointer);
      if (resume === null) resume = cursor + 2;
      cursor = pointer;
      continue;
    }
    if ((length & 0xc0) !== 0 || length > 63) throw new RetrievalError("DNS_FAILURE");
    cursor += 1;
    if (length === 0) {
      const end = resume ?? cursor;
      const name = labels.join(".").toLowerCase();
      if (!name) throw new RetrievalError("DNS_FAILURE");
      return { name, offset: end };
    }
    if (cursor + length > packet.length) throw new RetrievalError("DNS_FAILURE");
    const labelBytes = packet.subarray(cursor, cursor + length);
    if (labelBytes.some((byte) => byte < 0x21 || byte > 0x7e || byte === 0x2e)) throw new RetrievalError("DNS_FAILURE");
    labels.push(labelBytes.toString("ascii"));
    cursor += length;
  }
  throw new RetrievalError("DNS_FAILURE");
}

function parseResponse(packet, { id, hostname, type }) {
  if (packet.length < 12 || packet.length > MAX_PACKET || packet.readUInt16BE(0) !== id) throw new RetrievalError("DNS_FAILURE");
  const flags = packet.readUInt16BE(2);
  const questionCount = packet.readUInt16BE(4);
  const answerCount = packet.readUInt16BE(6);
  const authorityCount = packet.readUInt16BE(8);
  const additionalCount = packet.readUInt16BE(10);
  if ((flags & 0x8000) === 0 || (flags & 0x7800) !== 0 || (flags & 0x0040) !== 0 || questionCount !== 1) {
    throw new RetrievalError("DNS_FAILURE");
  }
  const rcode = flags & 0x000f;
  if (rcode !== 0) throw new RetrievalError("DNS_FAILURE");
  let cursor = 12;
  const question = decodeName(packet, cursor);
  cursor = question.offset;
  if (cursor + 4 > packet.length || question.name !== hostname) throw new RetrievalError("DNS_FAILURE");
  const qtype = packet.readUInt16BE(cursor);
  const qclass = packet.readUInt16BE(cursor + 2);
  cursor += 4;
  if (qtype !== type || qclass !== DNS_CLASS_IN) throw new RetrievalError("DNS_FAILURE");
  if ((flags & 0x0200) !== 0) return { truncated: true, records: [] };

  const records = [];
  const totalRecords = answerCount + authorityCount + additionalCount;
  if (totalRecords > 2_048) throw new RetrievalError("DNS_FAILURE");
  for (let index = 0; index < totalRecords; index += 1) {
    const owner = decodeName(packet, cursor);
    cursor = owner.offset;
    if (cursor + 10 > packet.length) throw new RetrievalError("DNS_FAILURE");
    const recordType = packet.readUInt16BE(cursor);
    const recordClass = packet.readUInt16BE(cursor + 2);
    const length = packet.readUInt16BE(cursor + 8);
    cursor += 10;
    if (cursor + length > packet.length) throw new RetrievalError("DNS_FAILURE");
    const end = cursor + length;
    let data;
    if (recordClass === DNS_CLASS_IN && recordType === TYPE_A) {
      if (length !== 4) throw new RetrievalError("DNS_FAILURE");
      data = [...packet.subarray(cursor, end)].join(".");
    } else if (recordClass === DNS_CLASS_IN && recordType === TYPE_AAAA) {
      if (length !== 16) throw new RetrievalError("DNS_FAILURE");
      data = [...Array(8)].map((_, part) => packet.readUInt16BE(cursor + part * 2).toString(16)).join(":");
    } else if (recordClass === DNS_CLASS_IN && recordType === TYPE_CNAME) {
      const cname = decodeName(packet, cursor);
      if (cname.offset !== end) throw new RetrievalError("DNS_FAILURE");
      data = cname.name;
    }
    if (data !== undefined && index < answerCount) records.push({ owner: owner.name, type: recordType, data });
    cursor = end;
  }
  if (cursor !== packet.length) throw new RetrievalError("DNS_FAILURE");
  return { truncated: false, records };
}

function systemNameservers() {
  return readFile("/etc/resolv.conf", "utf8").then((text) => {
    const servers = text.split(/\r?\n/)
      .map((line) => line.trim().match(/^nameserver\s+([^\s#]+)/)?.[1])
      .filter((address) => address && isIP(address));
    if (servers.length === 0) throw new RetrievalError("DNS_FAILURE");
    return [...new Set(servers)];
  }).catch((error) => {
    if (error instanceof RetrievalError) throw error;
    throw new RetrievalError("DNS_FAILURE", { cause: error });
  });
}

export class DnsWireResolver {
  constructor({ nameservers, port = 53 }) {
    if (!Array.isArray(nameservers) || nameservers.length === 0 || nameservers.some((server) => !isIP(server))) {
      throw new TypeError("DNS resolvers must be numeric IP addresses");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new TypeError("Invalid DNS port");
    this.nameservers = Object.freeze([...nameservers]);
    this.port = port;
  }

  async resolve(hostname, { signal, deadline = performance.now() + 30_000 } = {}) {
    ensureActive(signal, deadline);
    const host = validateHostname(hostname);
    if (isIP(host)) {
      if (!isPublicAddress(host)) throw new RetrievalError("POLICY_DENIED");
      return Object.freeze({ addresses: Object.freeze([host]), aliases: Object.freeze([]) });
    }
    const results = await Promise.all([TYPE_A, TYPE_AAAA].map((type) =>
      this.#resolveType(host, type, { signal, deadline, visited: new Set() })));
    ensureActive(signal, deadline);
    const addresses = [...new Set(results.flatMap((result) => result.addresses))];
    const aliases = [...new Set(results.flatMap((result) => result.aliases))];
    if (addresses.length === 0) throw new RetrievalError("DNS_FAILURE");
    if (addresses.some((address) => !isPublicAddress(address))) throw new RetrievalError("POLICY_DENIED");
    return Object.freeze({ addresses: Object.freeze(addresses), aliases: Object.freeze(aliases) });
  }

  async #resolveType(hostname, type, context) {
    const { signal, deadline, visited } = context;
    if (signal?.aborted) throw new RetrievalError("CANCELED");
    if (visited.size >= MAX_CNAME_HOPS || visited.has(hostname)) throw new RetrievalError("DNS_FAILURE");
    visited.add(hostname);
    const id = randomBytes(2).readUInt16BE(0);
    const request = queryPacket(hostname, type, id);
    let response;
    let lastError;
    for (const nameserver of this.nameservers) {
      try {
        response = await this.#udp(nameserver, request, { id, hostname, type, signal, deadline });
        if (response.truncated) {
          const tcp = await this.#tcp(nameserver, request, { id, hostname, type, signal, deadline });
          // Revalidate transaction, flags, question and all response fields on the TCP reply.
          response = parseResponse(tcp, { id, hostname, type });
          if (response.truncated) throw new RetrievalError("DNS_FAILURE");
        }
        break;
      } catch (error) {
        if (error instanceof RetrievalError && ["CANCELED", "DEADLINE_EXCEEDED", "POLICY_DENIED"].includes(error.code)) throw error;
        lastError = error;
      }
    }
    if (!response) throw new RetrievalError("DNS_FAILURE", { cause: lastError });
    const linked = response.records.filter((record) => record.owner === hostname && record.type === TYPE_CNAME);
    const direct = response.records.filter((record) => record.owner === hostname && record.type === type);
    if (linked.length > 1 && new Set(linked.map((record) => record.data)).size > 1) throw new RetrievalError("DNS_FAILURE");
    if (linked.length > 0 && direct.length > 0) throw new RetrievalError("DNS_FAILURE");
    if (direct.length > 0) {
      const addresses = direct.map((record) => record.data);
      if (addresses.some((address) => !isPublicAddress(address))) throw new RetrievalError("POLICY_DENIED");
      return { addresses, aliases: [] };
    }
    if (linked.length === 0) return { addresses: [], aliases: [] };
    if (isIP(linked[0].data)) throw new RetrievalError("DNS_FAILURE");
    const alias = validateHostname(linked[0].data);
    return this.#resolveType(alias, type, { signal, deadline, visited: new Set(visited) })
      .then((result) => ({ addresses: result.addresses, aliases: [alias, ...result.aliases] }));
  }

  #udp(nameserver, request, context) {
    const family = isIP(nameserver) === 6 ? "udp6" : "udp4";
    return new Promise((resolve, reject) => {
      const socket = createSocket(family);
      let settled = false;
      let started = false;
      let timer;
      const finish = (error, response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal?.removeEventListener("abort", onAbort);
        if (started) socket.close();
        if (error) reject(error);
        else resolve(response);
      };
      const onAbort = () => finish(new RetrievalError("CANCELED"));
      const onMessage = (packet) => {
        try {
          finish(null, parseResponse(packet, context));
        } catch (error) {
          finish(error);
        }
      };
      socket.once("error", (error) => finish(new RetrievalError("DNS_FAILURE", { cause: error })));
      socket.once("message", onMessage);
      context.signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => finish(new RetrievalError("DEADLINE_EXCEEDED")), remaining(context.deadline));
      if (context.signal?.aborted) return onAbort();
      started = true;
      socket.connect(this.port, nameserver, () => {
        socket.send(request, (error) => {
          if (error) finish(new RetrievalError("DNS_FAILURE", { cause: error }));
        });
      });
    });
  }

  #tcp(nameserver, request, context) {
    return new Promise((resolve, reject) => {
      const socket = connectStream({ host: nameserver, port: this.port });
      let settled = false;
      let timer;
      let data = Buffer.alloc(0);
      const framed = Buffer.alloc(request.length + 2);
      framed.writeUInt16BE(request.length, 0);
      request.copy(framed, 2);
      const finish = (error, packet) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal?.removeEventListener("abort", onAbort);
        socket.destroy();
        if (error) reject(error);
        else resolve(packet);
      };
      const onAbort = () => finish(new RetrievalError("CANCELED"));
      socket.once("error", (error) => finish(new RetrievalError("DNS_FAILURE", { cause: error })));
      socket.on("data", (chunk) => {
        data = Buffer.concat([data, chunk]);
        if (data.length > MAX_PACKET + 2) return finish(new RetrievalError("DNS_FAILURE"));
        if (data.length >= 2) {
          const expected = data.readUInt16BE(0) + 2;
          if (expected < 14 || expected > MAX_PACKET + 2) return finish(new RetrievalError("DNS_FAILURE"));
          if (data.length >= expected) finish(null, data.subarray(2, expected));
        }
      });
      context.signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => finish(new RetrievalError("DEADLINE_EXCEEDED")), remaining(context.deadline));
      if (context.signal?.aborted) return onAbort();
      socket.once("connect", () => {
        if (!socket.remoteAddress || !sameAddress(socket.remoteAddress, nameserver) || socket.remotePort !== this.port) {
          finish(new RetrievalError("DNS_FAILURE"));
          return;
        }
        socket.write(framed);
      });
    });
  }
}

export async function createSystemDnsResolver() {
  const nameservers = await systemNameservers();
  return new DnsWireResolver({ nameservers });
}
