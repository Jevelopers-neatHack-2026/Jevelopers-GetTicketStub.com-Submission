import { crc32 } from 'node:zlib';
import { hashBytes } from './runtime.mjs';
import { productionIssue, productionOk } from './production-errors.mjs';

export const productionArchiveLimits = Object.freeze({ payloads: 97, zip_entries: 98, outer_descriptors: 100, entry_bytes: 8388608, payload_bytes: 33554432, archive_bytes: 41943040, manifest_bytes: 4194304, detached_bytes: 1048576 });
export const safeProductionFilename = name => typeof name === 'string' && name.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes('..') && !/[. ]$/.test(name);

/** Stored-only, flat regular-file ZIP verification; no inflation or extraction. */
export function verifyProductionZip(input, expected) {
  const limits = productionArchiveLimits;
  if (!(input instanceof Uint8Array) || input.byteLength > limits.archive_bytes || !Array.isArray(expected) || expected.length > limits.zip_entries || expected.length < 1) return productionIssue('RESOURCE_LIMIT');
  if (input.byteLength < 22) return productionIssue('INTEGRITY_FAILURE');
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength), end = b.length - 22;
  if (b.readUInt32LE(end) !== 0x06054b50 || b.readUInt16LE(end + 4) !== 0 || b.readUInt16LE(end + 6) !== 0 || b.readUInt16LE(end + 20) !== 0) return productionIssue('INTEGRITY_FAILURE');
  const count = b.readUInt16LE(end + 10), centralStart = b.readUInt32LE(end + 16), centralSize = b.readUInt32LE(end + 12);
  if (count > limits.zip_entries) return productionIssue('RESOURCE_LIMIT');
  if (count !== expected.length || b.readUInt16LE(end + 8) !== count || centralStart + centralSize !== end || centralStart > end) return productionIssue('INTEGRITY_FAILURE');
  const descriptors = [...expected].sort((a, b) => a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0);
  if (new Set(descriptors.map(entry => entry.filename.toLowerCase())).size !== descriptors.length) return productionIssue('INTEGRITY_FAILURE');
  let central = centralStart, local = 0, total = 0;
  const records = [];
  for (const descriptor of descriptors) {
    if (central + 46 > end || local + 30 > centralStart || b.readUInt32LE(central) !== 0x02014b50 || b.readUInt32LE(local) !== 0x04034b50) return productionIssue('INTEGRITY_FAILURE');
    const size = b.readUInt32LE(central + 24), compressed = b.readUInt32LE(central + 20);
    const nameSize = b.readUInt16LE(central + 28), extraSize = b.readUInt16LE(central + 30), commentSize = b.readUInt16LE(central + 32);
    if (size > limits.entry_bytes || total + size > limits.payload_bytes + limits.manifest_bytes) return productionIssue('RESOURCE_LIMIT');
    if (compressed !== size || nameSize === 0 || nameSize > 128 || extraSize !== 0 || commentSize !== 0 || central + 46 + nameSize > end) return productionIssue('INTEGRITY_FAILURE');
    if (b.readUInt16LE(central + 4) !== 0x0314 || b.readUInt16LE(central + 6) !== 20 || b.readUInt16LE(local + 4) !== 20 || b.readUInt16LE(central + 8) !== 0 || b.readUInt16LE(central + 10) !== 0 || b.readUInt16LE(central + 34) !== 0 || b.readUInt16LE(central + 36) !== 0 || b.readUInt32LE(central + 38) !== 0x81a40000 || b.readUInt32LE(central + 42) !== local) return productionIssue('INTEGRITY_FAILURE');
    const nameBytes = b.subarray(central + 46, central + 46 + nameSize), name = nameBytes.toString('ascii');
    if (!Buffer.from(name, 'ascii').equals(nameBytes) || !safeProductionFilename(name) || name !== descriptor.filename || b.readUInt16LE(local + 26) !== nameSize || b.readUInt16LE(local + 28) !== 0 || local + 30 + nameSize + size > centralStart) return productionIssue('INTEGRITY_FAILURE');
    if (!b.subarray(local + 30, local + 30 + nameSize).equals(nameBytes)) return productionIssue('INTEGRITY_FAILURE');
    for (const [localOffset, centralOffset, length] of [[6,8,2],[8,10,2],[10,12,2],[12,14,2],[14,16,4],[18,20,4],[22,24,4]]) if (!b.subarray(local + localOffset, local + localOffset + length).equals(b.subarray(central + centralOffset, central + centralOffset + length))) return productionIssue('INTEGRITY_FAILURE');
    if (b.readUInt16LE(local + 10) !== 0 || b.readUInt16LE(local + 12) !== 0x2821) return productionIssue('INTEGRITY_FAILURE');
    const bytes = b.subarray(local + 30 + nameSize, local + 30 + nameSize + size);
    if (crc32(bytes) !== b.readUInt32LE(local + 14) || descriptor.byte_size !== size || descriptor.byte_hash !== hashBytes(bytes)) return productionIssue('INTEGRITY_FAILURE');
    records.push({ filename: name, bytes }); total += size;
    local += 30 + nameSize + size; central += 46 + nameSize;
  }
  if (local !== centralStart || central !== end) return productionIssue('INTEGRITY_FAILURE');
  return productionOk(records);
}
