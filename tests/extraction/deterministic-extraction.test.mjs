import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { extractDeterministically } from "../../src/extraction/index.mjs";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const SOURCE_URL = "https://events.example.test/calendar";
const FETCHED_AT = "2026-10-10T12:00:00.000Z";

async function fixture(name, contentType = "text/html; charset=utf-8") {
  const bytes = await readFile(fileURLToPath(new URL(name, FIXTURES)));
  return document(bytes, contentType);
}

function document(bytes, contentType = "text/html; charset=utf-8") {
  return { url: SOURCE_URL, fetchedAt: FETCHED_AT, contentType, bytes: Buffer.from(bytes) };
}

function assertExactRanges(result, sourceBytes) {
  const candidates = [
    ...result.canonicalSuggestions,
    ...result.pageMetadata,
    ...result.visibleText,
    ...result.statusMentions,
    ...result.accessSignals,
    ...result.events.flatMap((entity) => entity.candidates),
    ...result.organizations.flatMap((entity) => entity.candidates),
  ];
  for (const candidate of candidates) {
    const { startByte, endByte } = candidate.source.locator;
    assert.ok(startByte >= 0 && endByte >= startByte && endByte <= sourceBytes.length);
    assert.equal(sourceBytes.subarray(startByte, endByte).toString("utf8"), candidate.rawValue);
  }
  for (const entity of [...result.events, ...result.organizations]) {
    if (!entity.source) continue;
    const { startByte, endByte } = entity.source.locator;
    assert.equal(sourceBytes.subarray(startByte, endByte).toString("utf8")[0], "{");
    assert.ok(endByte <= sourceBytes.length);
  }
  for (const block of result.jsonLdBlocks) {
    const { startByte, endByte } = block.locator;
    assert.ok(endByte <= sourceBytes.length);
    assert.ok(endByte >= startByte);
  }
}

test("keeps multiple JSON-LD events separate and preserves exact UTF-8 byte positions", async () => {
  const input = await fixture("multi-event.html");
  const result = await extractDeterministically(input);

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.sourceHash, "sha256:" + createHash("sha256").update(input.bytes).digest("hex"));
  assert.deepEqual(result.parserVersions, {
    html: "parse5@8.0.1",
    htmlStream: "parse5-parser-stream@8.0.0",
    json: `node@${process.versions.node}/JSON.parse+ei-json-index@1`,
  });
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map((event) => event.ordinal), [0, 1]);
  assert.deepEqual(result.events.map((event) => event.jsonPointer), ["/@graph/0", "/@graph/1"]);
  assert.equal(result.events[0].candidates.find((candidate) => candidate.field === "name").normalizedValue, "Café Night 🎵");
  assert.equal(result.events[1].candidates.find((candidate) => candidate.field === "name").normalizedValue, "Fall Relay");
  assert.equal(result.organizations.length, 1);
  assert.equal(result.ambiguities[0].kind, "multiple_event_occurrences");
  assert.equal(result.visibleText.some((candidate) => /secret event text/i.test(candidate.normalizedValue)), false);
  assert.equal(result.visibleText.some((candidate) => /secret display copy/i.test(candidate.normalizedValue)), false);

  const remoteId = result.events[0].candidates.find((candidate) => candidate.source.property === "@id");
  assert.equal(remoteId.suggestionOnly, true);
  assert.equal(remoteId.normalizedValue, "https://remote.example/events/one");
  assert.equal(result.canonicalSuggestions[0].suggestionOnly, true);
  assert.equal(result.canonicalSuggestions[0].urlSuggestion, "https://events.example.test/calendar/fall");
  assertExactRanges(result, input.bytes);
});

test("retains visible cancellation and reschedule copy alongside conflicting metadata", async () => {
  const input = await fixture("conflict-cancellation.html");
  const result = await extractDeterministically(input);

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.statusMentions.length, 1);
  assert.match(result.statusMentions[0].normalizedValue, /Cancelled.*moved to 14 October/i);
  assert.ok(result.conflicts.some((conflict) => conflict.scope === result.events[0].entityId && conflict.field === "name"));
  assert.equal(result.visibleText.some((candidate) => /secret announcement/i.test(candidate.normalizedValue)), false);
  assertExactRanges(result, input.bytes);
});

test("does not infer JS_REQUIRED from an arbitrary script tag", async () => {
  const result = await extractDeterministically(await fixture("script-only-static.html"));
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.visibleText.length, 1);
});

test("reports JS_REQUIRED only for a sparse application shell or explicit noscript requirement", async () => {
  const shell = await extractDeterministically(await fixture("sparse-js-shell.html"));
  assert.equal(shell.status, "JS_REQUIRED");
  assert.equal(shell.visibleText.length, 0);

  const explicit = document(Buffer.from("<html><body><noscript>JavaScript is required to continue.</noscript></body></html>"));
  const requirement = await extractDeterministically(explicit);
  assert.equal(requirement.status, "JS_REQUIRED");
  assert.ok(requirement.diagnostics.some((item) => item.code === "NOSCRIPT_REQUIRES_JAVASCRIPT"));

  const hiddenRequirement = document(Buffer.from('<html><body><div hidden><noscript>JavaScript is required to continue.</noscript></div></body></html>'));
  assert.equal((await extractDeterministically(hiddenRequirement)).status, "NO_ANSWER");
  const directlyHiddenRequirement = document(Buffer.from('<html><body><noscript hidden>JavaScript is required to continue.</noscript></body></html>'));
  assert.equal((await extractDeterministically(directlyHiddenRequirement)).status, "NO_ANSWER");

  const templateShell = document(Buffer.from('<html><body><main id="root"></main><template><script src="/assets/app.js"></script></template></body></html>'));
  assert.equal((await extractDeterministically(templateShell)).status, "NO_ANSWER");
});

test("keeps surrogate pairs intact when callers lower the parser chunk limit", async () => {
  const input = document(Buffer.from("<p>Emoji 😊 after split</p>"));
  const result = await extractDeterministically(input, { limits: { htmlChunkCodeUnits: 1 } });
  assert.equal(result.visibleText[0].normalizedValue, "Emoji 😊 after split");
  assertExactRanges(result, input.bytes);
});

test("preserves BOM, CRLF, entity, and non-ASCII offsets against original bytes", async () => {
  const input = document(Buffer.from(
    '\uFEFF<!doctype html>\r\n<html><head><meta property="og:title" content="Caf&eacute; &amp; 🍵"></head>\r\n<body>\r\n<p>Line\r\n  café 🐈 &amp; tea</p>\r\n</body></html>',
  ));
  const result = await extractDeterministically(input);
  assert.equal(result.pageMetadata[0].rawValue, "Caf&eacute; &amp; 🍵");
  assert.equal(result.pageMetadata[0].normalizedValue, "Café & 🍵");
  assert.ok(result.visibleText.some((candidate) => candidate.normalizedValue.includes("café 🐈 & tea")));
  assertExactRanges(result, input.bytes);
});

test("retains later cancellation evidence after the general visible-text budget is exhausted", async () => {
  const input = document(Buffer.from("<html><body><p>General introduction.</p><p>Cancelled: this event has moved to a new date.</p></body></html>"));
  const result = await extractDeterministically(input, { limits: { maxVisibleTextSegments: 1 } });
  assert.equal(result.visibleText.length, 1);
  assert.equal(result.statusMentions.length, 1);
  assert.match(result.statusMentions[0].normalizedValue, /Cancelled.*new date/);
  assert.equal(result.status, "PARTIAL");
  assert.ok(result.diagnostics.some((item) => item.code === "VISIBLE_TEXT_LIMIT"));
  assertExactRanges(result, input.bytes);
});

test("reports access challenges while keeping their visible source evidence", async () => {
  const input = await fixture("access-restricted.html");
  const result = await extractDeterministically(input);
  assert.equal(result.status, "ACCESS_RESTRICTED");
  assert.ok(result.accessSignals.length > 0);
  assertExactRanges(result, input.bytes);
});

test("keeps malformed JSON-LD bounded and returns remaining visible evidence", async () => {
  const input = await fixture("malformed-jsonld.html");
  const result = await extractDeterministically(input);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.events.length, 0);
  assert.equal(result.jsonLdBlocks[0].status, "malformed");
  assert.ok(result.diagnostics.some((item) => item.code === "MALFORMED_JSONLD"));
  assert.ok(result.visibleText.some((candidate) => candidate.normalizedValue === "Visible fallback copy."));
  assertExactRanges(result, input.bytes);
});

test("returns stable empty, unsupported media, and encoding outcomes", async () => {
  const empty = await extractDeterministically(document(Buffer.alloc(0)));
  assert.equal(empty.status, "NO_ANSWER");

  const binary = await extractDeterministically(document(Buffer.from([0, 1, 2]), "application/octet-stream"));
  assert.equal(binary.status, "UNSUPPORTED_MEDIA");

  const legacyCharset = await extractDeterministically(document(Buffer.from("<p>hello</p>"), "text/html; charset=windows-1252"));
  assert.equal(legacyCharset.status, "UNSUPPORTED_ENCODING");

  const malformedUtf8 = await extractDeterministically(document(Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0x3c, 0x2f, 0x70, 0x3e])));
  assert.equal(malformedUtf8.status, "MALFORMED_ENCODING");

  const textWithMetaLikeCopy = await extractDeterministically(document(
    Buffer.from('<meta charset="windows-1252"> Plain text remains UTF-8.'),
    "text/plain; charset=utf-8",
  ));
  assert.equal(textWithMetaLikeCopy.status, "PARTIAL");
  assert.equal(textWithMetaLikeCopy.visibleText.length, 1);

  const jsonLdWithMetaLikeDescription = await extractDeterministically(document(
    Buffer.from('{"@type":"Event","name":"UTF-8 event","description":"<meta charset=\\"windows-1252\\">"}'),
    "application/ld+json",
  ));
  assert.equal(jsonLdWithMetaLikeDescription.status, "PARTIAL");
  assert.equal(jsonLdWithMetaLikeDescription.events.length, 1);
});

test("enforces document, DOM, and JSON-LD entity ceilings", async () => {
  const documentLimited = await extractDeterministically(await fixture("multi-event.html"), { limits: { maxDocumentBytes: 8 } });
  assert.equal(documentLimited.status, "RESOURCE_LIMIT");
  assert.equal(documentLimited.termination, "RESOURCE_LIMIT");

  const htmlLimited = await extractDeterministically(await fixture("multi-event.html"), { limits: { maxHtmlNodes: 2 } });
  assert.equal(htmlLimited.status, "RESOURCE_LIMIT");

  const entityLimited = await extractDeterministically(await fixture("multi-event.html"), { limits: { maxEntities: 1 } });
  assert.equal(entityLimited.events.length + entityLimited.organizations.length, 1);
  assert.ok(entityLimited.diagnostics.some((item) => item.code === "JSONLD_ENTITY_LIMIT"));
});

test("bounds page metadata, canonical suggestions, JSON-LD blocks, and entity candidates", async () => {
  const noisyPage = document(Buffer.from([
    '<link rel="canonical" href="/first">',
    '<link rel="canonical" href="/second">',
    '<meta property="og:title" content="First">',
    '<meta property="og:title" content="Second">',
  ].join("")));
  const pageLimited = await extractDeterministically(noisyPage, {
    limits: { maxCanonicalSuggestions: 1, maxPageMetadataCandidates: 1 },
  });
  assert.equal(pageLimited.canonicalSuggestions.length, 1);
  assert.equal(pageLimited.pageMetadata.length, 1);
  assert.ok(pageLimited.diagnostics.some((item) => item.code === "CANONICAL_SUGGESTION_LIMIT"));
  assert.ok(pageLimited.diagnostics.some((item) => item.code === "PAGE_METADATA_LIMIT"));

  const twoBlocks = document(Buffer.from([
    '<script type="application/ld+json">{"@type":"Event","name":"One"}</script>',
    '<script type="application/ld+json">{"@type":"Event","name":"Two"}</script>',
  ].join("")));
  const blockLimited = await extractDeterministically(twoBlocks, { limits: { maxJsonLdBlocks: 1 } });
  assert.equal(blockLimited.status, "RESOURCE_LIMIT");
  assert.ok(blockLimited.diagnostics.some((item) => item.code === "JSONLD_BLOCK_LIMIT"));

  const candidateLimited = await extractDeterministically(document(
    Buffer.from('{"@type":"Event","name":"One","startDate":"2026-10-12"}'),
    "application/ld+json",
  ), { limits: { maxCandidatesPerEntity: 1 } });
  assert.equal(candidateLimited.events[0].candidates.length, 1);
  assert.ok(candidateLimited.diagnostics.some((item) => item.code === "JSONLD_CANDIDATE_LIMIT"));
});

test("honors cancellation and does not access the network for canonical or remote IDs", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network access is outside deterministic extraction");
  };
  try {
    const input = await fixture("multi-event.html");
    const result = await extractDeterministically(input);
    assert.equal(fetchCalls, 0);
    assertExactRanges(result, input.bytes);

    const controller = new AbortController();
    controller.abort();
    const canceled = await extractDeterministically(input, { signal: controller.signal });
    assert.equal(canceled.status, "CANCELED");
    assert.equal(canceled.termination, "CANCELED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
