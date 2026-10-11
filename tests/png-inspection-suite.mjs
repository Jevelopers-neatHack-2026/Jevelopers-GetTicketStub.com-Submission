import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { inspectPngBytes, PNG_INSPECTION_LIMITS } from "../dist/png-inspection.js";
import {
  PNG_PRODUCER_FIXTURE_PINS,
  loadProducerPngFixture,
  makeCrcCorruptPng,
  makeHeaderOnlyPng,
  makePngFixture,
  referenceCrc32,
  standardCrcVector
} from "./png-inspection-fixtures.mjs";

const provenance = JSON.parse(await readFile(new URL("./fixtures/png-inspection/provenance.json", import.meta.url), "utf8"));
assert.equal(provenance.schema, "synthetic-producer-png-parser-fixtures/1");
assert.equal(provenance.evidenceClass, "private synthetic diagnostic renderer outputs; not a ProductionBundle and not approved for fulfillment");
assert.equal(provenance.handoffEligible, false);
assert.equal(provenance.printProduction.sourceCommit, "26e608e893b60f5d1e1bd22c47c639e0b1b3518f");
assert.equal(provenance.printProduction.sourceTree, "460cbc8b2e2919220860d489e447d6b21b111381");
assert.equal(provenance.printProduction.workflowRunId, 38124525468);
assert.equal(provenance.printProduction.artifactId, 11696439367);
for (const [name, pin] of Object.entries(PNG_PRODUCER_FIXTURE_PINS)) {
  const recorded = provenance.fixtureBytePins[pin.filename];
  assert.equal(recorded?.bytes, pin.byteLength, `${name}: provenance byte length differs from test pin`);
  assert.equal(recorded?.sha256, pin.sha256, `${name}: provenance digest differs from test pin`);
}

function inspect(bytes, ...expected) {
  return inspectPngBytes(bytes, ...expected);
}

function expectResult(bytes, status, code) {
  const observed = inspect(bytes);
  assert.equal(observed.status, status);
  assert.equal(observed.code, code);
  return observed;
}

function makeBytes(...values) {
  return Uint8Array.from(values);
}

function assertNoInputMutation(input, inspectResult) {
  const before = new Uint8Array(input);
  const result = inspectResult(input);
  assert.deepEqual(input, before);
  return result;
}

assert.equal(referenceCrc32(new TextEncoder().encode("123456789")), 0xcbf43926);
assert.equal(standardCrcVector().crc32, 0xcbf43926);

for (const name of ["arabic", "combining", "ligatures", "literal", "multiline", "wrap"]) {
  const bytes = await loadProducerPngFixture(name);
  const before = new Uint8Array(bytes);
  const observed = inspect(bytes);
  assert.deepEqual(bytes, before, `${name}: input bytes were not modified`);
  assert.equal(observed.status, "inspected", `${name}: should inspect the supported RGB8 profile`);
  assert.equal(observed.code, "ok");
  assert.equal(observed.format, "png");
  assert.equal(observed.contentType, "image/png");
  assert.equal(observed.byteLength, bytes.byteLength);
  assert.match(observed.sha256 ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.equal(observed.metadata?.width, 1200);
  assert.equal(observed.metadata?.height, 600);
  assert.equal(observed.metadata?.bitDepth, 8);
  assert.equal(observed.metadata?.colorType, 2);
  assert.equal(observed.metadata?.interlaceMethod, 0);
  assert.equal(observed.metadata?.filterTypesValid, true);
  assert.ok(observed.metadata?.chunks.includes("IHDR"));
  assert.ok(observed.metadata?.chunks.includes("IDAT"));
  assert.ok(observed.metadata?.chunks.includes("IEND"));
  assert.ok(Object.isFrozen(observed));
  assert.ok(Object.isFrozen(observed.expectations));
  assert.ok(Object.isFrozen(observed.metadata));
  assert.ok(Object.isFrozen(observed.metadata?.chunks));
  assert.equal("bytes" in observed, false);
}

const producerBytes = await loadProducerPngFixture("literal");
const producerHash = `sha256:${PNG_PRODUCER_FIXTURE_PINS.literal.sha256}`;
assert.equal(inspect(producerBytes).sha256, producerHash);
const matched = inspect(producerBytes, "image/png", producerBytes.byteLength, producerHash);
assert.equal(matched.status, "inspected");
assert.equal(matched.expectations.status, "matched");
assert.equal(matched.expectations.failures.length, 0);
const mismatch = inspect(producerBytes, "image/jpeg", producerBytes.byteLength + 1, "sha256:" + "0".repeat(64));
assert.equal(mismatch.status, "expectation_mismatch");
assert.equal(mismatch.code, "expectation_mismatch");
assert.deepEqual(mismatch.expectations.failures.map(({ field }) => field), ["contentType", "byteLength", "sha256"]);
const invalidExpectedValues = inspect(producerBytes, 23, -1, "not-a-sha256");
assert.equal(invalidExpectedValues.status, "expectation_mismatch");
assert.ok(invalidExpectedValues.expectations.failures.every(({ code }) => code === "invalid_expected_value"));

const pphys = makeBytes(0, 0, 0x0e, 0xc4, 0, 0, 0x0e, 0xc4, 1);
const srgb = makeBytes(0);
const splitPng = makePngFixture({
  width: 2,
  height: 3,
  beforeIdat: [{ type: "sRGB", data: srgb }, { type: "pHYs", data: pphys }],
  idatSplitPoints: [1, 3, 7],
  includeEmptyIdat: true,
  idatTrailingBytes: makeBytes(0xde, 0xad)
});
const splitObserved = inspect(splitPng);
assert.equal(splitObserved.status, "inspected");
assert.equal(splitObserved.metadata?.idatChunkCount, 5);
assert.equal(splitObserved.metadata?.srgbRenderingIntent, 0);
assert.deepEqual(splitObserved.metadata?.physicalResolution, {
  pixelsPerUnitX: 3780,
  pixelsPerUnitY: 3780,
  unit: "metre",
  dpiX: 3780 * 0.0254,
  dpiY: 3780 * 0.0254
});

for (let intent = 0; intent <= 3; intent += 1) {
  const png = makePngFixture({ beforeIdat: [{ type: "sRGB", data: makeBytes(intent) }] });
  const observed = inspect(png);
  assert.equal(observed.status, "inspected");
  assert.equal(observed.metadata?.srgbRenderingIntent, intent);
}

const allFilterTypes = makeBytes(
  0, 0, 0, 0,
  1, 0, 0, 0,
  2, 0, 0, 0,
  3, 0, 0, 0,
  4, 0, 0, 0
);
const filteredPng = makePngFixture({ width: 1, height: 5, filteredOverride: allFilterTypes });
assert.equal(inspect(filteredPng).status, "inspected");

const unknownUnitPng = makePngFixture({
  beforeIdat: [{ type: "pHYs", data: makeBytes(0, 0, 0, 1, 0, 0, 0, 2, 0) }]
});
const unknownUnit = inspect(unknownUnitPng);
assert.equal(unknownUnit.status, "inspected");
assert.equal(unknownUnit.metadata?.physicalResolution?.unit, "unknown");
assert.equal(unknownUnit.metadata?.physicalResolution?.dpiX, null);

const splitAfterUnknown = makePngFixture({
  afterIdat: [{ type: "tEXt", data: makeBytes(0x6b, 0x65, 0x79, 0, 0x76) }, { type: "IDAT", data: makeBytes() }]
});
expectResult(splitAfterUnknown, "invalid", "idat_noncontiguous");
expectResult(makePngFixture({ afterIdat: [{ type: "tEXt", data: makeBytes(0x6b, 0, 0x76) }] }), "unsupported", "unsupported_chunk");
expectResult(makePngFixture({ beforeIdat: [{ type: "PLTE", data: makeBytes(0, 0, 0) }] }), "unsupported", "unsupported_chunk");
expectResult(makePngFixture({ beforeIdat: [{ type: "texT", data: makeBytes() }] }), "invalid", "chunk_reserved_bit_invalid");
expectResult(makePngFixture({ beforeIdat: [{ type: "1DAT", data: makeBytes() }] }), "invalid", "chunk_type_invalid");
expectResult(makePngFixture({ beforeIdat: [{ type: "IHDR", data: makeBytes(0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0) }] }), "invalid", "ihdr_duplicate");
expectResult(makePngFixture({ beforeIdat: [{ type: "sRGB", data: makeBytes(0) }, { type: "sRGB", data: makeBytes(0) }] }), "invalid", "chunk_duplicate");
expectResult(makePngFixture({ bitDepth: 16 }), "unsupported", "profile_not_supported");
expectResult(makePngFixture({ interlaceMethod: 1 }), "unsupported", "profile_not_supported");
expectResult(makePngFixture({ colorType: 2, bitDepth: 4 }), "invalid", "ihdr_combination_invalid");
expectResult(makePngFixture({ width: 0 }), "invalid", "ihdr_dimensions_invalid");
expectResult(makeHeaderOnlyPng(0xffffffff, 1), "invalid", "ihdr_dimensions_invalid");
expectResult(makePngFixture({ beforeIdat: [{ type: "pHYs", data: makeBytes(0, 0, 0, 1) }] }), "invalid", "phys_length_invalid");
expectResult(makePngFixture({ beforeIdat: [{ type: "pHYs", data: makeBytes(0, 0, 0, 1, 0, 0, 0, 1, 2) }] }), "invalid", "phys_unit_invalid");
expectResult(makePngFixture({ afterIdat: [{ type: "pHYs", data: makeBytes(0, 0, 0, 1, 0, 0, 0, 1, 1) }] }), "invalid", "chunk_order_invalid");
expectResult(makePngFixture({ beforeIdat: [{ type: "sRGB", data: makeBytes(5) }] }), "invalid", "srgb_value_invalid");
expectResult(makePngFixture({ omitIdat: true }), "invalid", "idat_missing");
expectResult(makePngFixture({ omitIend: true }), "invalid", "iend_invalid");
expectResult(makePngFixture({ iendData: makeBytes(1) }), "invalid", "iend_invalid");
expectResult(makePngFixture({ trailingFileBytes: makeBytes(0) }), "invalid", "trailing_file_data");
expectResult(makePngFixture().slice(0, -2), "invalid", "chunk_header_truncated");
const oversizedChunkLength = Buffer.from(makePngFixture());
oversizedChunkLength.writeUInt32BE(0x80000000, 8);
expectResult(oversizedChunkLength, "invalid", "chunk_length_invalid");
const truncatedChunkData = Buffer.from(makePngFixture());
truncatedChunkData.writeUInt32BE(0x7fffffff, 8 + 12 + 13);
expectResult(truncatedChunkData, "invalid", "chunk_data_truncated");
const crcCorrupt = makeCrcCorruptPng(makePngFixture());
assert.equal(assertNoInputMutation(crcCorrupt, (input) => inspect(input)).code, "chunk_crc_mismatch");
expectResult(makePngFixture({ compressedOverride: makeBytes(1, 2, 3) }), "invalid", "zlib_invalid");
const adlerCorrupt = Buffer.from(deflateSync(makeBytes(0, 0, 0, 0)));
adlerCorrupt[adlerCorrupt.byteLength - 1] ^= 0x01;
expectResult(makePngFixture({ compressedOverride: adlerCorrupt }), "invalid", "zlib_invalid");
expectResult(makePngFixture({ filteredOverride: makeBytes(5, 0, 0, 0) }), "invalid", "scanline_filter_invalid");
expectResult(makePngFixture({ filteredOverride: makeBytes(0) }), "invalid", "scanline_size_mismatch");
expectResult(makeHeaderOnlyPng(8193, 1), "resource_limit", "dimension_limit");
expectResult(makeHeaderOnlyPng(5000, 4000), "resource_limit", "pixel_count_limit");

const tooManyChunks = makePngFixture({
  beforeIdat: Array.from({ length: PNG_INSPECTION_LIMITS.maxChunkCount - 1 }, () => ({ type: "tEXt", data: makeBytes() }))
});
expectResult(tooManyChunks, "resource_limit", "chunk_count_limit");
expectResult(new Uint8Array(PNG_INSPECTION_LIMITS.maxInputBytes + 1), "resource_limit", "input_too_large");

const decompressionBomb = deflateSync(Buffer.alloc(PNG_INSPECTION_LIMITS.maxInflatedBytes + 1));
expectResult(makePngFixture({ compressedOverride: decompressionBomb }), "resource_limit", "zlib_output_limit");

for (const [bytes, format, contentType] of [
  [makeBytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31), "pdf", "application/pdf"],
  [makeBytes(0xff, 0xd8, 0xff, 0xd9), "jpeg", "image/jpeg"],
  [makeBytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50), "webp", "image/webp"],
  [makeBytes(0x50, 0x4b, 0x03, 0x04), "zip", "application/zip"]
]) {
  const observed = inspect(bytes);
  assert.equal(observed.status, "unsupported");
  assert.equal(observed.code, "format_not_supported");
  assert.equal(observed.format, format);
  assert.equal(observed.contentType, contentType);
  assert.equal(observed.metadata, null);
}
expectResult(makeBytes(1, 2, 3), "invalid", "signature_mismatch");

const accessorInput = makePngFixture();
Object.defineProperty(accessorInput, "length", { get() { throw new Error("must not invoke input getters"); } });
assert.equal(inspect(accessorInput).status, "inspected");
const proxyInput = new Proxy(makePngFixture(), {});
expectResult(proxyInput, "invalid", "input_invalid");
expectResult(new Uint16Array([0x5089]), "unsupported", "input_view_unsupported");
if (typeof SharedArrayBuffer !== "undefined") {
  expectResult(new Uint8Array(new SharedArrayBuffer(8)), "unsupported", "shared_memory_unsupported");
}
const untouched = makePngFixture();
assertNoInputMutation(untouched, (input) => inspect(input));
assert.equal(inspect(Buffer.from(makePngFixture())).status, "inspected");

console.log("PNG inspection suite passed.");
