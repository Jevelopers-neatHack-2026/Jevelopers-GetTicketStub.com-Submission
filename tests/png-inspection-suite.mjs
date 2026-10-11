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
import {
  PNG_INSPECTION_SUITE_CASE_IDS,
  parsePngInspectionOutput,
  runPngInspectionTests,
  validPngInspectionRunnerReport
} from "../scripts/run-png-inspection-tests.mjs";

const cases = [];
function add(id, run) {
  cases.push({ id, run });
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

function makeSuccessfulCaseOutput() {
  const report = {
    schemaVersion: "fulfillment-png-inspection-case-results/1",
    suite: "png-inspection",
    caseCount: PNG_INSPECTION_SUITE_CASE_IDS.length,
    passed: PNG_INSPECTION_SUITE_CASE_IDS.length,
    failed: 0,
    skipped: 0,
    cases: PNG_INSPECTION_SUITE_CASE_IDS.map((id) => ({ id, status: "passed" }))
  };
  return `${JSON.stringify(report)}\n`;
}

add("provenance.synthetic-fixture-pins", async () => {
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
});

add("crc.reference-vector", () => {
  assert.equal(referenceCrc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(standardCrcVector().crc32, 0xcbf43926);
});

for (const name of ["arabic", "combining", "ligatures", "literal", "multiline", "wrap"]) {
  add(`fixture.${name}.supported-profile-unchanged`, async () => {
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
  });
}

add("expectations.exact-match", async () => {
  const producerBytes = await loadProducerPngFixture("literal");
  const producerHash = `sha256:${PNG_PRODUCER_FIXTURE_PINS.literal.sha256}`;
  assert.equal(inspect(producerBytes).sha256, producerHash);
  const matched = inspect(producerBytes, "image/png", producerBytes.byteLength, producerHash);
  assert.equal(matched.status, "inspected");
  assert.equal(matched.expectations.status, "matched");
  assert.equal(matched.expectations.failures.length, 0);
});

add("expectations.mismatch-and-invalid-values", async () => {
  const producerBytes = await loadProducerPngFixture("literal");
  const mismatch = inspect(producerBytes, "image/jpeg", producerBytes.byteLength + 1, `sha256:${"0".repeat(64)}`);
  assert.equal(mismatch.status, "expectation_mismatch");
  assert.equal(mismatch.code, "expectation_mismatch");
  assert.deepEqual(mismatch.expectations.failures.map(({ field }) => field), ["contentType", "byteLength", "sha256"]);
  const invalidExpectedValues = inspect(producerBytes, 23, -1, "not-a-sha256");
  assert.equal(invalidExpectedValues.status, "expectation_mismatch");
  assert.ok(invalidExpectedValues.expectations.failures.every(({ code }) => code === "invalid_expected_value"));
});

add("idat.split-empty-trailing-and-color-metadata", () => {
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
});

for (let intent = 0; intent <= 3; intent += 1) {
  add(`srgb.intent-${intent}`, () => {
    const png = makePngFixture({ beforeIdat: [{ type: "sRGB", data: makeBytes(intent) }] });
    const observed = inspect(png);
    assert.equal(observed.status, "inspected");
    assert.equal(observed.metadata?.srgbRenderingIntent, intent);
  });
}

add("scanline.accepts-filter-tags-0-through-4", () => {
  const allFilterTypes = makeBytes(
    0, 0, 0, 0,
    1, 0, 0, 0,
    2, 0, 0, 0,
    3, 0, 0, 0,
    4, 0, 0, 0
  );
  const filteredPng = makePngFixture({ width: 1, height: 5, filteredOverride: allFilterTypes });
  assert.equal(inspect(filteredPng).status, "inspected");
});

add("phys.unknown-unit-does-not-infer-dpi", () => {
  const unknownUnitPng = makePngFixture({
    beforeIdat: [{ type: "pHYs", data: makeBytes(0, 0, 0, 1, 0, 0, 0, 2, 0) }]
  });
  const unknownUnit = inspect(unknownUnitPng);
  assert.equal(unknownUnit.status, "inspected");
  assert.equal(unknownUnit.metadata?.physicalResolution?.unit, "unknown");
  assert.equal(unknownUnit.metadata?.physicalResolution?.dpiX, null);
});

add("chunks.reject-order-and-unsupported-chunks", () => {
  const splitAfterUnknown = makePngFixture({
    afterIdat: [{ type: "tEXt", data: makeBytes(0x6b, 0x65, 0x79, 0, 0x76) }, { type: "IDAT", data: makeBytes() }]
  });
  expectResult(splitAfterUnknown, "invalid", "idat_noncontiguous");
  expectResult(makePngFixture({ afterIdat: [{ type: "tEXt", data: makeBytes(0x6b, 0, 0x76) }] }), "unsupported", "unsupported_chunk");
  expectResult(makePngFixture({ beforeIdat: [{ type: "PLTE", data: makeBytes(0, 0, 0) }] }), "unsupported", "unsupported_chunk");
});

add("chunks.reject-malformed-type-and-duplicates", () => {
  expectResult(makePngFixture({ beforeIdat: [{ type: "texT", data: makeBytes() }] }), "invalid", "chunk_reserved_bit_invalid");
  expectResult(makePngFixture({ beforeIdat: [{ type: "1DAT", data: makeBytes() }] }), "invalid", "chunk_type_invalid");
  expectResult(makePngFixture({ beforeIdat: [{ type: "IHDR", data: makeBytes(0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0) }] }), "invalid", "ihdr_duplicate");
  expectResult(makePngFixture({ beforeIdat: [{ type: "sRGB", data: makeBytes(0) }, { type: "sRGB", data: makeBytes(0) }] }), "invalid", "chunk_duplicate");
});

add("ihdr.reject-unsupported-and-invalid-profiles", () => {
  expectResult(makePngFixture({ bitDepth: 16 }), "unsupported", "profile_not_supported");
  expectResult(makePngFixture({ interlaceMethod: 1 }), "unsupported", "profile_not_supported");
  expectResult(makePngFixture({ colorType: 2, bitDepth: 4 }), "invalid", "ihdr_combination_invalid");
});

add("dimensions.reject-zero-and-invalid-values", () => {
  expectResult(makePngFixture({ width: 0 }), "invalid", "ihdr_dimensions_invalid");
  expectResult(makeHeaderOnlyPng(0xffffffff, 1), "invalid", "ihdr_dimensions_invalid");
});

add("metadata.reject-invalid-phys-srgb-and-order", () => {
  expectResult(makePngFixture({ beforeIdat: [{ type: "pHYs", data: makeBytes(0, 0, 0, 1) }] }), "invalid", "phys_length_invalid");
  expectResult(makePngFixture({ beforeIdat: [{ type: "pHYs", data: makeBytes(0, 0, 0, 1, 0, 0, 0, 1, 2) }] }), "invalid", "phys_unit_invalid");
  expectResult(makePngFixture({ afterIdat: [{ type: "pHYs", data: makeBytes(0, 0, 0, 1, 0, 0, 0, 1, 1) }] }), "invalid", "chunk_order_invalid");
  expectResult(makePngFixture({ beforeIdat: [{ type: "sRGB", data: makeBytes(5) }] }), "invalid", "srgb_value_invalid");
});

add("chunks.reject-truncation-length-and-trailing-bytes", () => {
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
});

add("crc.reject-corruption-without-mutation", () => {
  const crcCorrupt = makeCrcCorruptPng(makePngFixture());
  assert.equal(assertNoInputMutation(crcCorrupt, (input) => inspect(input)).code, "chunk_crc_mismatch");
});

add("zlib.reject-invalid-stream-and-adler-checksum", () => {
  expectResult(makePngFixture({ compressedOverride: makeBytes(1, 2, 3) }), "invalid", "zlib_invalid");
  const adlerCorrupt = Buffer.from(deflateSync(makeBytes(0, 0, 0, 0)));
  adlerCorrupt[adlerCorrupt.byteLength - 1] ^= 0x01;
  expectResult(makePngFixture({ compressedOverride: adlerCorrupt }), "invalid", "zlib_invalid");
});

add("scanline.reject-invalid-filter-and-length", () => {
  expectResult(makePngFixture({ filteredOverride: makeBytes(5, 0, 0, 0) }), "invalid", "scanline_filter_invalid");
  expectResult(makePngFixture({ filteredOverride: makeBytes(0) }), "invalid", "scanline_size_mismatch");
});

add("limits.reject-dimensions-pixels-and-chunks", () => {
  expectResult(makeHeaderOnlyPng(8193, 1), "resource_limit", "dimension_limit");
  expectResult(makeHeaderOnlyPng(5000, 4000), "resource_limit", "pixel_count_limit");
  const tooManyChunks = makePngFixture({
    beforeIdat: Array.from({ length: PNG_INSPECTION_LIMITS.maxChunkCount - 1 }, () => ({ type: "tEXt", data: makeBytes() }))
  });
  expectResult(tooManyChunks, "resource_limit", "chunk_count_limit");
});

add("limits.reject-oversized-input", () => {
  expectResult(new Uint8Array(PNG_INSPECTION_LIMITS.maxInputBytes + 1), "resource_limit", "input_too_large");
});

add("limits.reject-inflation-over-cap", () => {
  const decompressionBomb = deflateSync(Buffer.alloc(PNG_INSPECTION_LIMITS.maxInflatedBytes + 1));
  expectResult(makePngFixture({ compressedOverride: decompressionBomb }), "resource_limit", "zlib_output_limit");
});

add("formats.recognize-unsupported-pdf-jpeg-webp-zip", () => {
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
});

add("formats.reject-unknown-signature", () => {
  expectResult(makeBytes(1, 2, 3), "invalid", "signature_mismatch");
});

add("inputs.reject-proxies-views-and-shared-memory", () => {
  const proxyInput = new Proxy(makePngFixture(), {});
  expectResult(proxyInput, "invalid", "input_invalid");
  expectResult(new Uint16Array([0x5089]), "unsupported", "input_view_unsupported");
  if (typeof SharedArrayBuffer !== "undefined") {
    expectResult(new Uint8Array(new SharedArrayBuffer(8)), "unsupported", "shared_memory_unsupported");
  }
});

add("inputs.reject-revoked-and-trap-proxies-without-reading-expectations", () => {
  const revoked = Proxy.revocable(makePngFixture(), {});
  revoked.revoke();
  expectResult(revoked.proxy, "invalid", "input_invalid");

  let trapCalls = 0;
  const trapProxy = new Proxy(makePngFixture(), {
    get() { trapCalls += 1; throw new Error("input getter must not run"); },
    getOwnPropertyDescriptor() { trapCalls += 1; throw new Error("input descriptor trap must not run"); },
    ownKeys() { trapCalls += 1; throw new Error("input keys trap must not run"); }
  });
  expectResult(trapProxy, "invalid", "input_invalid");
  assert.equal(trapCalls, 0);
});

add("inputs.ignore-overridden-instance-properties", () => {
  const accessorInput = makePngFixture();
  let getterCalls = 0;
  for (const property of ["buffer", "byteLength", "byteOffset", "length"]) {
    Object.defineProperty(accessorInput, property, {
      get() { getterCalls += 1; throw new Error("must not invoke input getters"); }
    });
  }
  assert.equal(inspect(accessorInput).status, "inspected");
  assert.equal(getterCalls, 0);
});

add("inputs.accept-buffer-and-never-mutate", () => {
  const untouched = makePngFixture();
  assertNoInputMutation(untouched, (input) => inspect(input));
  assert.equal(inspect(Buffer.from(makePngFixture())).status, "inspected");
});

add("expectations.reject-hostile-values-without-calling-traps", () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const observed = inspect(makePngFixture(), revoked.proxy, revoked.proxy, revoked.proxy);
  assert.equal(observed.status, "expectation_mismatch");
  assert.deepEqual(observed.expectations.failures.map(({ field, code }) => [field, code]), [
    ["contentType", "invalid_expected_value"],
    ["byteLength", "invalid_expected_value"],
    ["sha256", "invalid_expected_value"]
  ]);
});

add("api.package-root-export-and-readonly-result", async () => {
  const packageApi = await import("@jevelopers/fulfillment-connectors");
  assert.equal(packageApi.inspectPngBytes, inspectPngBytes);
  assert.equal(packageApi.PNG_INSPECTION_LIMITS, PNG_INSPECTION_LIMITS);
  const observed = packageApi.inspectPngBytes(makePngFixture());
  assert.equal(observed.status, "inspected");
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(Object.isFrozen(observed.metadata), true);
  assert.equal(Object.isFrozen(observed.metadata?.chunks), true);
});

add("runner.output-parser.rejects-malformed-and-inconsistent-reports", () => {
  const valid = makeSuccessfulCaseOutput();
  const parsed = JSON.parse(valid);
  assert.equal(parsePngInspectionOutput(valid).valid, true);
  for (const output of [
    "",
    "not json\n",
    valid.slice(0, -1),
    valid.replaceAll("\n", "\r\n"),
    `${valid}${valid}`,
    `${JSON.stringify({ ...parsed, skipped: 1 })}\n`,
    `${JSON.stringify({ ...parsed, passed: parsed.passed - 1 })}\n`,
    `${JSON.stringify({ ...parsed, extra: true })}\n`
  ]) assert.equal(parsePngInspectionOutput(output).valid, false);
});

add("runner.output-parser.requires-exact-case-identity", () => {
  const valid = JSON.parse(makeSuccessfulCaseOutput());
  const duplicate = structuredClone(valid);
  duplicate.cases[1].id = duplicate.cases[0].id;
  const missing = structuredClone(valid);
  missing.cases.pop();
  const extra = structuredClone(valid);
  extra.cases[0].id = "unlisted.case";
  const reversed = structuredClone(valid);
  reversed.cases.reverse();
  const extraCaseField = structuredClone(valid);
  extraCaseField.cases[0].detail = "injected";
  for (const report of [duplicate, missing, extra, reversed, extraCaseField]) {
    assert.equal(parsePngInspectionOutput(`${JSON.stringify(report)}\n`).valid, false);
  }
});

add("runner.process-control-rejects-stderr-and-nonzero-exit", () => {
  const stdout = makeSuccessfulCaseOutput();
  const nonzero = runPngInspectionTests({ spawn: () => ({ stdout, stderr: "", status: 1, signal: null }) });
  assert.equal(validPngInspectionRunnerReport(nonzero), true);
  assert.equal(nonzero.status, "failed");
  assert.ok(nonzero.results.some(({ name }) => name === "runner.process-exit"));
  const stderr = runPngInspectionTests({ spawn: () => ({ stdout, stderr: "unexpected", status: 0, signal: null }) });
  assert.equal(validPngInspectionRunnerReport(stderr), true);
  assert.equal(stderr.status, "failed");
  assert.ok(stderr.results.some(({ name }) => name === "runner.stderr"));
  const signaled = runPngInspectionTests({ spawn: () => ({ stdout, stderr: "", status: null, signal: "SIGTERM" }) });
  assert.equal(validPngInspectionRunnerReport(signaled), true);
  assert.equal(signaled.status, "failed");
  assert.equal(signaled.processSignal, "SIGTERM");
  const failingCases = JSON.parse(stdout);
  failingCases.cases[0] = { id: failingCases.cases[0].id, status: "failed", detail: "assertion_failed" };
  failingCases.passed -= 1;
  failingCases.failed += 1;
  const failedSuite = runPngInspectionTests({
    spawn: () => ({ stdout: `${JSON.stringify(failingCases)}\n`, stderr: "", status: 1, signal: null })
  });
  assert.equal(validPngInspectionRunnerReport(failedSuite), true);
  assert.equal(failedSuite.status, "failed");
  assert.equal(failedSuite.results[0].name, "provenance.synthetic-fixture-pins");
  assert.equal(failedSuite.results[0].detail, "assertion_failed");
});

add("runner.process-control-rejects-spawn-errors-and-malformed-output", () => {
  const failedSpawn = runPngInspectionTests({ spawn: () => { const error = new Error("ignored"); error.code = "ENOENT"; throw error; } });
  assert.equal(validPngInspectionRunnerReport(failedSpawn), true);
  assert.equal(failedSpawn.status, "failed");
  assert.equal(failedSpawn.processError, "ENOENT");
  const malformed = runPngInspectionTests({ spawn: () => ({ stdout: "{}\n", stderr: "", status: 0, signal: null }) });
  assert.equal(validPngInspectionRunnerReport(malformed), true);
  assert.equal(malformed.status, "failed");
  assert.ok(malformed.results.some(({ name }) => name === "runner.output-validation"));
});

add("runner.report-validator-rejects-unsafe-or-inconsistent-reports", () => {
  const valid = runPngInspectionTests({ spawn: () => ({ stdout: makeSuccessfulCaseOutput(), stderr: "", status: 0, signal: null }) });
  assert.equal(validPngInspectionRunnerReport(valid), true);
  assert.equal(validPngInspectionRunnerReport({ ...valid, injected: "field" }), false);
  assert.equal(validPngInspectionRunnerReport({ ...valid, passed: valid.passed - 1 }), false);
  assert.equal(validPngInspectionRunnerReport({ ...valid, orderCalls: 1 }), false);
  assert.equal(validPngInspectionRunnerReport({ ...valid, results: [...valid.results, valid.results[0]], passed: valid.passed + 1 }), false);
});

const caseRecords = [];
for (const testCase of cases) {
  try {
    await testCase.run();
    caseRecords.push({ id: testCase.id, status: "passed" });
  } catch (error) {
    const detail = error instanceof assert.AssertionError ? "assertion_failed" : "case_execution_failed";
    caseRecords.push({ id: testCase.id, status: "failed", detail });
  }
}

const passed = caseRecords.filter((record) => record.status === "passed").length;
const failed = caseRecords.length - passed;
process.stdout.write(`${JSON.stringify({
  schemaVersion: "fulfillment-png-inspection-case-results/1",
  suite: "png-inspection",
  caseCount: cases.length,
  passed,
  failed,
  skipped: 0,
  cases: caseRecords
})}\n`);
if (failed !== 0) process.exitCode = 1;
