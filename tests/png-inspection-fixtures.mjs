import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const fixtureDirectory = new URL("./fixtures/png-inspection/", import.meta.url);
const fixturePins = Object.freeze({
  arabic: Object.freeze({ filename: "arabic.png", byteLength: 18593, sha256: "cb854eb314186863ea9feadb1a528943c8577cf94f9650c784483ea6a1c78cac" }),
  combining: Object.freeze({ filename: "combining.png", byteLength: 20806, sha256: "ec750e61355d4c073936c0307e97181b32ae4916421e8d6131d6d72d24a9ca13" }),
  ligatures: Object.freeze({ filename: "ligatures.png", byteLength: 20129, sha256: "de1ba142cf66e2a859bd48dce8c68357e05923563a58dd6fe51e288c0cdb9dcd" }),
  literal: Object.freeze({ filename: "literal.png", byteLength: 24814, sha256: "5ec23ec09090de89f33a99bfc5e297a30c668bebae10120b6951c0e0a6264925" }),
  multiline: Object.freeze({ filename: "multiline.png", byteLength: 17679, sha256: "bfb00490268f0c98de7729bd5970559876b4f0f2f8d8e4c09b3b4270da2a2ecc" }),
  wrap: Object.freeze({ filename: "wrap.png", byteLength: 44252, sha256: "6f248c94659f7ee3fdd135e424b1fa99bd465e67b4aefa1307fbbd9c464231d8" })
});

export const PNG_PRODUCER_FIXTURE_PINS = fixturePins;
export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export async function loadProducerPngFixture(name) {
  const pin = fixturePins[name];
  assert.ok(pin, "fixture name must be pinned");
  const bytes = new Uint8Array(await readFile(new URL(pin.filename, fixtureDirectory)));
  assert.equal(bytes.byteLength, pin.byteLength, `${name} fixture byte length changed`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), pin.sha256, `${name} fixture hash changed`);
  return bytes;
}

/** Independent bit-at-a-time reference implementation used only to construct test chunks. */
export function referenceCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  assert.equal(typeBytes.byteLength, 4);
  const dataBytes = Buffer.from(data);
  const output = Buffer.alloc(12 + dataBytes.byteLength);
  output.writeUInt32BE(dataBytes.byteLength, 0);
  typeBytes.copy(output, 4);
  dataBytes.copy(output, 8);
  output.writeUInt32BE(referenceCrc32(output.subarray(4, 8 + dataBytes.byteLength)), 8 + dataBytes.byteLength);
  return output;
}

function ihdr(width, height, bitDepth, colorType, interlaceMethod) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = bitDepth;
  data[9] = colorType;
  data[10] = 0;
  data[11] = 0;
  data[12] = interlaceMethod;
  return chunk("IHDR", data);
}

function channelsFor(colorType) {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  return 3;
}

function filteredRows(width, height, bitDepth, colorType, filterType) {
  const rowBytes = Math.ceil(width * channelsFor(colorType) * bitDepth / 8);
  const result = Buffer.alloc(height * (rowBytes + 1));
  for (let row = 0; row < height; row += 1) result[row * (rowBytes + 1)] = filterType;
  return result;
}

function splitAt(bytes, points, includeEmpty = false) {
  const cuts = [0, ...points, bytes.byteLength].sort((left, right) => left - right);
  const parts = [];
  for (let index = 1; index < cuts.length; index += 1) {
    parts.push(bytes.subarray(cuts[index - 1], cuts[index]));
  }
  if (includeEmpty) parts.splice(Math.floor(parts.length / 2), 0, Buffer.alloc(0));
  return parts;
}

export function makePngFixture({
  width = 1,
  height = 1,
  bitDepth = 8,
  colorType = 2,
  interlaceMethod = 0,
  filterType = 0,
  beforeIdat = [],
  afterIdat = [],
  idatSplitPoints = [],
  includeEmptyIdat = false,
  compressedOverride,
  idatTrailingBytes = new Uint8Array(),
  filteredOverride,
  omitIdat = false,
  omitIend = false,
  iendData = new Uint8Array(),
  trailingFileBytes = new Uint8Array()
} = {}) {
  const ihdrChunk = ihdr(width, height, bitDepth, colorType, interlaceMethod);
  const compressedInput = filteredOverride ?? filteredRows(width, height, bitDepth, colorType, filterType);
  const compressed = Buffer.concat([
    Buffer.from(compressedOverride ?? deflateSync(compressedInput)),
    Buffer.from(idatTrailingBytes)
  ]);
  const chunks = [ihdrChunk, ...beforeIdat.map(({ type, data }) => chunk(type, data))];
  if (!omitIdat) {
    for (const part of splitAt(compressed, idatSplitPoints, includeEmptyIdat)) chunks.push(chunk("IDAT", part));
  }
  for (const item of afterIdat) chunks.push(chunk(item.type, item.data));
  if (!omitIend) chunks.push(chunk("IEND", iendData));
  return new Uint8Array(Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    ...chunks,
    Buffer.from(trailingFileBytes)
  ]));
}

export function makeHeaderOnlyPng(width, height, { bitDepth = 8, colorType = 2, interlaceMethod = 0 } = {}) {
  return new Uint8Array(Buffer.concat([Buffer.from(PNG_SIGNATURE), ihdr(width, height, bitDepth, colorType, interlaceMethod)]));
}

export function makeCrcCorruptPng(bytes, chunkName = "IDAT") {
  const copy = Buffer.from(bytes);
  let offset = PNG_SIGNATURE.byteLength;
  while (offset + 12 <= copy.byteLength) {
    const length = copy.readUInt32BE(offset);
    const type = copy.toString("ascii", offset + 4, offset + 8);
    const crcOffset = offset + 8 + length;
    if (crcOffset + 4 > copy.byteLength) break;
    if (type === chunkName) {
      copy[crcOffset + 3] ^= 0x01;
      return new Uint8Array(copy);
    }
    offset = crcOffset + 4;
  }
  throw new Error("requested chunk not found in test fixture");
}

export function standardCrcVector() {
  const input = Buffer.from("123456789", "ascii");
  return Object.freeze({ input: input.toString("ascii"), crc32: referenceCrc32(input) });
}
