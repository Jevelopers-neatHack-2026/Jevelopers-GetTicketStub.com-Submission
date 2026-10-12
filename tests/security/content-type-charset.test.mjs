import assert from "node:assert/strict";
import test from "node:test";
import { SafeFetcher, RetrievalError } from "../../src/security/controlled-fetch.mjs";
import { runWithSafeFetchLifecycle } from "../../src/security/internal/fetch-lifecycle.mjs";
import { extractDeterministically } from "../../src/extraction/index.mjs";
import { fixtureUrl, localTestSeam, png, respond, startFixture } from "./support.mjs";

const EVENT_HTML = Buffer.from('<!doctype html><script type="application/ld+json">'
  + '{"@type":"Event","name":"Café evening","startDate":"2027-06-20"}</script>');

async function fixture(t, contentType, { body = EVENT_HTML, svg = false } = {}) {
  const observed = { requests: 0, dials: 0, decodeStarts: 0, bodyCompletions: 0, knownZero: [] };
  const server = await startFixture((_request, response) => {
    observed.requests += 1;
    respond(response, 200, { "content-type": contentType }, body);
  });
  t.after(() => server.close());
  const fetcher = new SafeFetcher(localTestSeam({
    port: server.port,
    onDial() { observed.dials += 1; },
  }));
  const url = fixtureUrl(server.port, "/public-synthetic-event");
  const fetch = () => runWithSafeFetchLifecycle(fetcher, {
    onDecodeStart() { observed.decodeStarts += 1; },
    onBodyComplete() { observed.bodyCompletions += 1; },
    onKnownZero({ reason }) { observed.knownZero.push(reason); },
  }, {}, () => svg ? fetcher.fetchSvgAsset(url) : fetcher.fetch(url));
  return { observed, fetch, url };
}

async function assertHeaderRefused(local) {
  await assert.rejects(local.fetch(), (error) => {
    assert.ok(error instanceof RetrievalError);
    assert.equal(error.code, "UNSUPPORTED_MEDIA");
    assert.equal(error.cause, undefined);
    assert.equal(error.message, "The response media type is unsupported or inconsistent.");
    assert.equal(error.stack.includes(local.url), false);
    return true;
  });
  assert.deepEqual(local.observed, {
    requests: 1, dials: 1, decodeStarts: 0, bodyCompletions: 0,
    knownZero: ["content_type_rejected"],
  });
}

test("HTTP charset declaration cannot be erased before deterministic event extraction", async (t) => {
  const local = await fixture(t, "text/html; charset=iso-8859-1");
  const declared = await extractDeterministically({
    url: local.url, contentType: "text/html; charset=iso-8859-1", bytes: EVENT_HTML,
    fetchedAt: "2026-10-12T14:00:00.000Z",
  });
  assert.equal(declared.status, "UNSUPPORTED_ENCODING");
  assert.equal(declared.events.length, 0);
  await assertHeaderRefused(local);
});

for (const [name, contentType] of [
  ["legacy charset", "text/html; charset=windows-1252"],
  ["UTF-16 charset", 'text/html; Charset="UTF-16"'],
  ["unsupported ASCII alias", "text/html; charset=us-ascii"],
  ["conflicting charsets", "text/html; charset=utf-8; charset=iso-8859-1"],
  ["repeated equivalent charsets", 'text/html; charset=utf-8; CHARSET="UTF-8"'],
  ["empty charset", "text/html; charset="],
  ["empty quoted charset", 'text/html; charset=""'],
  ["whitespace in quoted charset", 'text/html; charset=" utf-8 "'],
  ["unclosed quoted charset", 'text/html; charset="utf-8'],
  ["unterminated escape", 'text/html; charset="utf-8\\'],
  ["characters after closing quote", 'text/html; charset="utf-8"junk'],
  ["charset without value", "text/html; charset"],
  ["whitespace before equals", "text/html; charset =utf-8"],
  ["whitespace after equals", "text/html; charset= utf-8"],
  ["single quotes are not HTTP quoted strings", "text/html; charset='utf-8'"],
  ["extended charset parameter", "text/html; charset*=UTF-8''utf-8"],
  ["continued charset parameter", 'text/html; charset*0="utf-8"'],
  ["combined header values", "text/html; charset=utf-8, text/html; charset=iso-8859-1"],
  ["malformed unrelated parameter", "text/html; note"],
  ["non-ASCII parameter name", "text/html; char\u00a0set=utf-8"],
  ["duplicate Content-Type fields", ["text/html; charset=utf-8", "text/html; charset=iso-8859-1"]],
  ["duplicate equivalent Content-Type fields", ["text/html; charset=utf-8", "text/html; charset=utf-8"]],
]) {
  test(`rejects ${name} before body decoding`, async (t) => {
    await assertHeaderRefused(await fixture(t, contentType));
  });
}

for (const [name, contentType] of [
  ["absent charset", "text/html"],
  ["UTF-8 token", "text/html;charset=utf-8"],
  ["UTF8 alias", "text/html; charset=UTF8"],
  ["case-insensitive quoted charset", 'Text/HTML;Charset="UTF-8"'],
  ["escaped quoted charset", 'text/html; charset="utf\\-8"'],
  ["empty parameter segments", "text/html; ; charset=utf-8;"],
  ["optional whitespace", 'text/html \t;\tcharset="utf-8" \t; note=ok'],
  ["unrelated quoted semicolon and charset text", 'text/html; note="event; charset=iso-8859-1"; charset=utf-8'],
  ["escaped quote in unrelated parameter", 'text/html; note="event\\\"; note=extra"; charset=utf8'],
]) {
  test(`preserves ${name} with the existing normalized contentType result`, async (t) => {
    const local = await fixture(t, contentType);
    const document = await local.fetch();
    assert.equal(document.contentType, "text/html");
    assert.deepEqual(document.bytes, EVENT_HTML);
    const extraction = await extractDeterministically(document);
    assert.equal(extraction.status, "PARTIAL");
    assert.equal(extraction.events[0].candidates.find((candidate) => candidate.field === "name").normalizedValue, "Café evening");
    assert.deepEqual(local.observed, {
      requests: 1, dials: 1, decodeStarts: 1, bodyCompletions: 1, knownZero: [],
    });
  });
}

for (const [name, contentType, body, svg] of [
  ["plain text", "text/plain; charset=utf8; format=flowed", Buffer.from("Café evening"), false],
  ["JSON", 'application/json; charset="UTF-8"', Buffer.from('{"name":"Café evening"}'), false],
  ["JSON-LD", "application/ld+json; charset=utf-8", Buffer.from('{"@type":"Event","name":"Café evening"}'), false],
  ["XHTML", "application/xhtml+xml; charset=utf-8", Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body>Café evening</body></html>'), false],
  ["controlled SVG", 'image/svg+xml; charset="UTF8"', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'), true],
  ["binary image metadata", 'image/png; name="event; poster.png"', png(2, 2), false],
]) {
  test(`preserves supported parameterized ${name}`, async (t) => {
    const local = await fixture(t, contentType, { body, svg });
    const document = await local.fetch();
    assert.equal(document.contentType, contentType.split(";", 1)[0]);
    assert.deepEqual(document.bytes, body);
    assert.equal(local.observed.decodeStarts, 1);
    assert.equal(local.observed.bodyCompletions, 1);
  });
}

test("controlled SVG charset refusal uses the same pre-decode boundary", async (t) => {
  await assertHeaderRefused(await fixture(t, "image/svg+xml; charset=iso-8859-1", {
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), svg: true,
  }));
});
