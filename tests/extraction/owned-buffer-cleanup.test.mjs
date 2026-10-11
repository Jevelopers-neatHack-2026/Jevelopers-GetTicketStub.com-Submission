import assert from "node:assert/strict";
import test from "node:test";

import { extractDeterministically } from "../../src/extraction/index.mjs";

function document(contentType = "text/plain") {
  return {
    url: "https://events.example.test/source",
    contentType,
    fetchedAt: "2026-10-10T12:00:00.000Z",
    redirects: 0,
    bytes: Buffer.from("A private source body with enough text to inspect."),
  };
}

async function captureExtractorBuffers(operation) {
  const originalFrom = Buffer.from;
  const allocations = [];
  Buffer.from = function capturedFrom(...args) {
    const result = Reflect.apply(originalFrom, this, args);
    if (new Error().stack?.includes("/src/extraction/index.mjs:91:")) allocations.push(result);
    return result;
  };
  try {
    try {
      const result = await operation();
      return { result, allocations };
    } catch (error) {
      return { error, allocations };
    }
  } finally {
    Buffer.from = originalFrom;
  }
}

function assertWiped(buffer) {
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.every((byte) => byte === 0));
}

test("the extractor wipes its owned source snapshot after success and unsupported media", async () => {
  const successInput = document();
  const originalSuccessBytes = Buffer.from(successInput.bytes);
  const success = await captureExtractorBuffers(() => extractDeterministically(successInput));
  assert.equal(success.result.status, "PARTIAL");
  assert.deepEqual(successInput.bytes, originalSuccessBytes, "caller-owned bytes remain intact");
  assert.equal(success.allocations.length, 1);
  assertWiped(success.allocations[0]);

  const unsupportedInput = document("application/octet-stream");
  const originalUnsupportedBytes = Buffer.from(unsupportedInput.bytes);
  const unsupported = await captureExtractorBuffers(() => extractDeterministically(unsupportedInput));
  assert.equal(unsupported.result.status, "UNSUPPORTED_MEDIA");
  assert.deepEqual(unsupportedInput.bytes, originalUnsupportedBytes, "caller-owned bytes remain intact");
  assert.equal(unsupported.allocations.length, 1);
  assertWiped(unsupported.allocations[0]);
});

test("the extractor wipes its owned source snapshot after cancellation and thrown parser control", async () => {
  const canceledInput = document("application/xhtml+xml; charset=utf-8");
  canceledInput.bytes = Buffer.from(`<root>${"<item>private</item>".repeat(256)}</root>`);
  const controller = new AbortController();
  const canceled = await captureExtractorBuffers(async () => {
    const pending = extractDeterministically(canceledInput, {
      signal: controller.signal,
      limits: { htmlChunkCodeUnits: 1 },
    });
    controller.abort();
    return pending;
  });
  assert.equal(canceled.result.status, "CANCELED");
  assert.equal(canceled.allocations.length, 1);
  assertWiped(canceled.allocations[0]);
  assert.ok(canceledInput.bytes.some((byte) => byte !== 0), "caller-owned source remains intact");

  const thrownInput = document();
  const controllerForThrow = new AbortController();
  let reads = 0;
  Object.defineProperty(controllerForThrow.signal, "aborted", {
    configurable: true,
    get() {
      reads += 1;
      if (reads > 1) throw new Error("injected signal read failure");
      return false;
    },
  });
  const thrown = await captureExtractorBuffers(() => extractDeterministically(thrownInput, {
    signal: controllerForThrow.signal,
  }));
  assert.match(thrown.error?.message ?? "", /injected signal read failure/);
  assert.equal(thrown.allocations.length, 1);
  assertWiped(thrown.allocations[0]);
});
