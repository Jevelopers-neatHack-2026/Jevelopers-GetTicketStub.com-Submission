import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { createEvidenceStore } from "../../../src/evidence/store.mjs";
import { extractDeterministically } from "../../../src/extraction/index.mjs";
import {
  composeSourceIdentity,
  SourceIdentityCompositionError,
} from "../../../src/discovery/identity/from-extraction.mjs";

const FIXTURES = new URL("../../extraction/fixtures/", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PINNED_COMPOSER_COMMIT = "d91e08d666abc243ae456a7f9f1bc9c745ca4f8d";
const PINNED_COMPOSER_SHA256 = "f21e0fd50bda5edb8f0bc5fb11dcd2c79ab8fc10c721f9749638c33ca832f63d";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function request(tenantId = "tenant-a", allowPrivate = true) {
  return { principal: { tenantId }, allowPrivate };
}

async function createHarness(t, overrides = {}, { clock: suppliedClock } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ei-source-identity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const clock = suppliedClock ?? { value: Date.now() };
  const permits = new WeakMap();
  const createPermit = (tenantId = "tenant-a", durationMs = 120_000) => {
    const permit = Object.freeze(Object.create(null));
    permits.set(permit, { tenantId, expiresAtMs: clock.value + durationMs });
    return permit;
  };
  const storeOptions = {
    directory,
    resolveTenant: (authenticatedRequest) => authenticatedRequest?.principal?.tenantId,
    resolveKey({ tenantId, purpose, keyId }) {
      const selectedId = `${purpose}-test-v1`;
      if (keyId && keyId !== selectedId) throw new Error("KEY-CANARY-SHOULD-NOT-ESCAPE");
      return { keyId: selectedId, key: createHash("sha256").update(`${tenantId}:${purpose}:test-key`).digest() };
    },
    resolveRetention({ tenantId, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (kind === "evidence") {
        const permit = permits.get(retentionHandle);
        if (!permit || permit.tenantId !== tenantId) throw new Error("RETENTION-CANARY-SHOULD-NOT-ESCAPE");
        return { expiresAtMs: permit.expiresAtMs, policyId: "test-private", policyVersion: "1", accessPolicy: "tenant_private" };
      }
      return {
        expiresAtMs: sourceExpiresAtMs ?? nowMs + 60_000,
        policyId: "test-private-fact",
        policyVersion: "1",
        accessPolicy: "tenant_private",
      };
    },
    authorizePrivateAccess({ tenantId, request: authenticatedRequest }) {
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
    authorizePrivateAccessCurrent({ tenantId, request: authenticatedRequest }) {
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
    now: () => clock.value,
    maxSourceBytes: 2 * 1024 * 1024,
    maxPositionBytes: 64 * 1024,
    maxPositionCount: 128,
    maxStoredPayloadBytes: 512 * 1024,
    maxRetentionMs: 180_000,
    ...overrides,
  };
  const store = createEvidenceStore(storeOptions);
  const openStore = () => createEvidenceStore(storeOptions);
  return { directory, store, openStore, clock, createPermit };
}

async function fixture(name) {
  return readFile(fileURLToPath(new URL(name, FIXTURES)));
}

async function loadPinnedLegacyComposer(t) {
  const sourcePath = "src/discovery/identity/from-extraction.mjs";
  const extracted = spawnSync("git", ["show", `${PINNED_COMPOSER_COMMIT}:${sourcePath}`], {
    cwd: REPO_ROOT,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(extracted.status, 0, `pinned legacy composer source must exist at ${PINNED_COMPOSER_COMMIT}`);
  assert.equal(digest(extracted.stdout), PINNED_COMPOSER_SHA256, "legacy composer bytes must match the audited pinned implementation");
  const sourceDirectory = path.join(REPO_ROOT, "src/discovery/identity");
  const modulePath = path.join(sourceDirectory, `.legacy-d91-composer-${process.pid}-${randomUUID()}.mjs`);
  await writeFile(modulePath, extracted.stdout, { flag: "wx", mode: 0o600 });
  t.after(() => rm(modulePath, { force: true }));
  return import(pathToFileURL(modulePath).href);
}

function factFingerprint(fact) {
  return JSON.stringify({
    factId: fact.factId,
    field: fact.field,
    status: fact.status,
    rawValue: fact.rawValue,
    normalizedValue: fact.normalizedValue,
    precision: fact.precision,
    supports: fact.supports.map((support) => ({
      contentHash: support.contentHash,
      duplicateGroupId: support.duplicateGroupId,
      independence: support.independence,
    })),
  });
}

function document(bytes, url = "https://events.example.test/calendar") {
  return { url, contentType: "text/html; charset=utf-8", fetchedAt: new Date().toISOString(), redirects: 0, bytes };
}

function eventGraph(count, detailed = false) {
  const events = Array.from({ length: count }, (_, index) => ({
    "@type": "Event",
    name: `Event ${index}`,
    ...(detailed ? {
      series: `Series ${index}`,
      edition: `Edition ${index}`,
      startDate: `2027-${String((index % 12) + 1).padStart(2, "0")}-01`,
      endDate: `2027-${String((index % 12) + 1).padStart(2, "0")}-02`,
      eventStatus: "https://schema.org/EventScheduled",
      location: { name: `Hall ${index}`, address: { addressLocality: `City ${index}` } },
    } : {}),
  }));
  return Buffer.from(`<!doctype html><script type="application/ld+json">${JSON.stringify({ "@graph": events })}</script>`);
}

function jsonLdScripts(blocks) {
  const scripts = blocks.map((block) => `<script type="application/ld+json">${JSON.stringify(block)}</script>`).join("");
  return Buffer.from(`<!doctype html>${scripts}`);
}

function eventScripts(count) {
  const blocks = [];
  for (let offset = 0; offset < count; offset += 3) {
    const events = Array.from({ length: Math.min(3, count - offset) }, (_, index) => ({
      "@type": "Event",
      name: `Block ${blocks.length} Event ${index}`,
    }));
    blocks.push({ "@graph": events });
  }
  return jsonLdScripts(blocks);
}

function sourceInput(store, doc, retentionHandle, authenticatedRequest = request()) {
  return {
    sources: [{ document: doc, retentionHandle }],
    request: authenticatedRequest,
    evidenceStore: store,
  };
}

async function expectCompositionError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof SourceIdentityCompositionError);
    assert.equal(error.code, code);
    assert.equal(error.message.includes("CANARY"), false);
    return true;
  });
}

for (const [code, contentType, content] of [
  ["JS_REQUIRED", "text/html", '<html><body><noscript>JavaScript is required to continue</noscript></body></html>'],
  ["ACCESS_RESTRICTED", "text/html", '<html><body><h1>Access denied</h1></body></html>'],
  ["UNSUPPORTED_MEDIA", "application/octet-stream", 'unsupported source bytes'],
  ["UNSUPPORTED_ENCODING", "text/html", '<html><head><meta charset="iso-8859-1"></head><body>Legacy encoding</body></html>'],
  ["MALFORMED_ENCODING", "text/html", Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0x3c, 0x2f, 0x70, 0x3e])],
]) {
  test(`preserves ${code} extraction refusal before persisting source facts`, async (t) => {
    const harness = await createHarness(t);
    const doc = { ...document(Buffer.from(content)), contentType };
    const original = Buffer.from(doc.bytes);
    assert.equal((await extractDeterministically(doc)).status, code, 'the actual extractor establishes the refusal');

    await expectCompositionError(
      composeSourceIdentity(sourceInput(harness.store, doc, harness.createPermit())), code,
    );

    const scope = await harness.store.scopeForAuthenticatedRequest(request());
    const stored = await harness.store.integritySnapshot(scope);
    assert.equal(stored.availableEvidence, 0);
    assert.equal(stored.availableFacts, 0);
    assert.deepEqual(doc.bytes, original, 'the caller still owns its unchanged source bytes');
  });
}

test("binds multibyte extraction claims to full-source evidence and keeps distinct events separate", async (t) => {
  const harness = await createHarness(t);
  const bytes = await fixture("multi-event.html");
  const original = Buffer.from(bytes);
  const doc = document(bytes);
  const result = await composeSourceIdentity(sourceInput(harness.store, doc, harness.createPermit()));

  assert.equal(result.sources[0].extraction.events.length, 2);
  assert.equal(result.occurrenceCandidates.length, 2);
  assert.equal(result.occurrenceDecisions.length, 1);
  assert.equal(result.occurrenceDecisions[0].relation, "review");
  assert.ok(result.occurrenceDecisions[0].reasonCodes.includes("instant_mismatch"));
  assert.equal(result.sourceAuthority, "not_evaluated");
  assert.equal(result.occurrenceDecisions[0].sourceAuthority, "not_evaluated");
  assert.equal(result.transitionLinks.length, 0);
  assert.deepEqual(doc.bytes, original, "the caller's completed retrieval bytes remain unchanged");

  const fullHash = digest(bytes);
  assert.equal(result.sources[0].evidence.contentHash, fullHash);
  assert.equal(result.sources[0].storedSource.contentHash, fullHash);
  assert.equal(result.sources[0].storedSource.sourceUrl, doc.url);
  assert.equal(result.sources[0].storedSource.retrievedAt, doc.fetchedAt);
  assert.equal(result.sources[0].observedRetrievedAt, doc.fetchedAt);
  assert.ok(result.facts.length >= 5);
  for (const fact of result.facts) {
    assert.equal(fact.status, "sourced");
    assert.equal(fact.supports.length, 1);
    assert.equal(fact.supports[0].contentHash, fullHash);
    assert.equal(fact.supports[0].independence, "unknown");
  }
  const dateFact = result.facts.find((fact) => fact.field === "startDate");
  assert.equal(dateFact.rawValue, '"2026-10-12T19:00:00-04:00"');
  assert.equal(dateFact.normalizedValue, "2026-10-12T19:00:00-04:00");
  assert.equal(result.occurrenceCandidates[0].facts.start[0].precision, "instant");
  assert.equal(result.occurrenceCandidates[0].facts.title[0].value, "Café Night 🎵");
  assert.equal(result.occurrenceCandidates[0].facts.status[0].value, "scheduled");

  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const evidence = await harness.store.lookupEvidence(scope, result.sources[0].evidence.evidenceId);
  const positions = await harness.store.listEvidencePositions(scope, evidence, request());
  assert.ok(positions.length > 0);
  assert.ok(positions.every((position) => position.contentHash !== fullHash));
  const firstLocator = positions[0].locator;
  assert.equal(positions[0].contentHash, digest(bytes.subarray(firstLocator.startByte, firstLocator.endByte)));
});

test("keeps exact JSON tokens separate from extractor-normalized identity values", async (t) => {
  const harness = await createHarness(t);
  const name = "  New\tYear\nNight  ";
  const startDate = " 2027-01-01 ";
  const bytes = Buffer.from(`<!doctype html><script type="application/ld+json">${JSON.stringify({
    "@type": "Event",
    name,
    startDate,
  })}</script>`);
  const result = await composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit()));

  const nameFact = result.facts.find((fact) => fact.field === "name");
  const dateFact = result.facts.find((fact) => fact.field === "startDate");
  assert.equal(nameFact.rawValue, JSON.stringify(name));
  assert.equal(nameFact.normalizedValue, "New Year Night");
  assert.equal(dateFact.rawValue, JSON.stringify(startDate));
  assert.equal(dateFact.normalizedValue, "2027-01-01");
  assert.equal(result.occurrenceCandidates[0].facts.title[0].value, "New Year Night");
  assert.equal(result.occurrenceCandidates[0].facts.start[0].value, "2027-01-01");
  assert.equal(result.occurrenceCandidates[0].facts.start[0].precision, "date");
});

test("structured identity claims require nested JSON paths instead of dotted display labels", async (t) => {
  const harness = await createHarness(t);
  const bytes = jsonLdScripts([{ "@graph": [{
    "@type": "Event",
    name: "Nested location event",
    "location.name": "Unrelated dotted venue",
    "location.address.addressLocality": "Unrelated dotted city",
    "location.address": { addressLocality: "Unrelated dotted parent" },
    location: {
      name: "Actual Hall",
      "address.addressLocality": "Unrelated dotted child",
      address: { addressLocality: "Actual City" },
    },
  }] }]);
  const result = await composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit()));
  const occurrence = result.occurrenceCandidates[0];
  assert.deepEqual(occurrence.facts.venue.map((claim) => claim.value), ["Actual Hall"]);
  assert.deepEqual(occurrence.facts.city.map((claim) => claim.value), ["Actual City"]);
  assert.deepEqual(result.facts.map((fact) => fact.normalizedValue).sort(), ["Actual City", "Actual Hall", "Nested location event"]);
  const extraction = result.sources[0].extraction;
  assert.ok(extraction.events[0].candidates.some((candidate) => candidate.source.jsonPointer === "/@graph/0/location.name"),
    "unsupported literal keys remain inspectable in the original extraction");
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const evidence = await harness.store.lookupEvidence(scope, result.sources[0].evidence.evidenceId);
  const positions = await harness.store.listEvidencePositions(scope, evidence, request());
  assert.equal(positions.length, 3, "only the three supported fields are selected for fact evidence");
});

test("literal dotted keys alone cannot create sourced identity facts", async (t) => {
  const harness = await createHarness(t);
  const writes = [];
  const observedStore = Object.fromEntries([
    "scopeForAuthenticatedRequest", "ingestEvidence", "appendFact", "materializeSelected",
  ].map((method) => [method, (...args) => {
    if (method === "ingestEvidence" || method === "appendFact") writes.push(method);
    return harness.store[method](...args);
  }]));
  const bytes = jsonLdScripts([{
    "@type": "Event",
    "location.name": "Unrelated dotted venue",
    "location.address.addressLocality": "Unrelated dotted city",
  }]);
  await expectCompositionError(
    composeSourceIdentity(sourceInput(observedStore, document(bytes), harness.createPermit())),
    "NO_IDENTITY_CANDIDATES",
  );
  assert.deepEqual(writes, [], "unsupported-only fields stop before source or fact ingestion");
});

test("structured identity paths stay relative to their exact escaped entity pointer", async (t) => {
  const harness = await createHarness(t);
  const bytes = jsonLdScripts([{ "events/~[0]": [
    { "@type": "Event", name: "Escaped parent", location: { name: "Real Hall", address: { addressLocality: "Real City" } } },
    { "@type": "Organization", name: "Distinct organizer", "location.name": "Unrelated venue" },
  ] }]);
  const result = await composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit()));
  assert.equal(result.sources[0].extraction.events[0].jsonPointer, "/events~1~0[0]/0");
  assert.equal(result.occurrenceCandidates[0].facts.venue[0].value, "Real Hall");
  assert.equal(result.occurrenceCandidates[0].facts.city[0].value, "Real City");
  assert.equal(result.entityCandidates[0].names[0].value, "Distinct organizer");
  assert.equal(result.facts.length, 4);
});

const XHTML_IDENTITY_CASES = [
  {
    label: "numeric and predefined XML references",
    nameToken: '"  Caf&#xE9; &amp; Night  "',
    expected: "Café & Night",
  },
  {
    label: "XML encoded JSON quotes",
    nameToken: "&quot;Café Night&quot;",
    expected: "Café Night",
  },
  {
    label: "a JSON scalar spanning CDATA boundaries",
    nameToken: '"Caf<![CDATA[é]]> Night"',
    expected: "Café Night",
  },
];

for (const fixture of XHTML_IDENTITY_CASES) {
  test(`XHTML identity retains exact source bytes for ${fixture.label}`, async (t) => {
    const harness = await createHarness(t);
    const bytes = Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>🧭</title>'
      + `<script type="application/ld+json">{"@type":"Event","name":${fixture.nameToken},"startDate":"2027-01-01"}</script>`
      + '</head><body/></html>');
    const doc = { ...document(bytes), contentType: "application/xhtml+xml; charset=utf-8" };
    const result = await composeSourceIdentity(sourceInput(harness.store, doc, harness.createPermit()));
    const nameFact = result.facts.find((fact) => fact.field === "name");
    assert.equal(nameFact.rawValue, fixture.nameToken);
    assert.equal(nameFact.normalizedValue, fixture.expected);
    assert.equal(nameFact.status, "sourced");
    assert.equal(nameFact.supports[0].contentHash, digest(bytes));
    assert.equal(result.occurrenceCandidates[0].facts.title[0].value, fixture.expected);
    assert.equal(result.occurrenceCandidates[0].facts.start[0].precision, "date");
    const sourceCandidate = result.sources[0].extraction.events[0].candidates.find((candidate) => candidate.field === "name");
    const { startByte, endByte } = sourceCandidate.source.locator;
    assert.equal(bytes.subarray(startByte, endByte).toString("utf8"), fixture.nameToken);
    const reopened = harness.openStore();
    const scope = await reopened.scopeForAuthenticatedRequest(request());
    const factHandle = await reopened.lookupFact(scope, nameFact.factId);
    const readback = await reopened.readFact(scope, factHandle, request());
    assert.equal(readback.rawValue, fixture.nameToken);
    assert.equal(readback.normalizedValue, fixture.expected);
    const replay = await composeSourceIdentity(sourceInput(reopened, doc, harness.createPermit()));
    const contentFingerprint = (fact) => factFingerprint({ ...fact, factId: undefined });
    assert.deepEqual(replay.facts.map(contentFingerprint), result.facts.map(contentFingerprint));
    assert.deepEqual(replay.occurrenceCandidates, result.occurrenceCandidates);
    assert.equal(replay.sources[0].evidence.evidenceId, result.sources[0].evidence.evidenceId);
    assert.equal(factFingerprint(await reopened.readFact(scope, factHandle, request())), factFingerprint(readback),
      "recomposition does not mutate the original immutable fact");
  });
}

test("the composer snapshots caller bytes and source arrays before its first async step", async (t) => {
  const harness = await createHarness(t);
  const bytes = await fixture("multi-event.html");
  const original = Buffer.from(bytes);
  const doc = document(bytes);
  const permit = harness.createPermit();
  const sources = [{ document: doc, retentionHandle: permit }];
  const pending = composeSourceIdentity({ sources, request: request(), evidenceStore: harness.store });
  doc.bytes.fill(0);
  sources.length = 0;
  const result = await pending;
  assert.equal(result.sources[0].evidence.contentHash, digest(original));
  assert.equal(result.occurrenceCandidates.length, 2);
});

test("retains cancellation and reschedule status while leaving unsupported predecessor links unresolved", async (t) => {
  const harness = await createHarness(t);
  const bytes = Buffer.from(`<!doctype html><script type="application/ld+json">${JSON.stringify({
    "@graph": [
      { "@type": "Event", name: "Night Market", startDate: "2027-05-11", eventStatus: "https://schema.org/EventCancelled" },
      { "@type": "Event", name: "Night Market replacement", startDate: "2027-05-12", eventStatus: "https://schema.org/EventRescheduled" },
    ],
  })}</script><p>The event was cancelled.</p>`);
  const result = await composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit()));

  assert.equal(result.occurrenceCandidates.length, 2);
  assert.deepEqual(result.occurrenceCandidates.map((candidate) => candidate.facts.status[0].value).sort(), ["canceled", "rescheduled"]);
  assert.equal(result.sources[0].extraction.statusMentions.length, 1);
  assert.deepEqual(result.transitionLinks, []);
  assert.deepEqual(result.unresolvedTransitions.map((transition) => transition.transition).sort(), ["canceled", "rescheduled"]);
  assert.ok(result.unresolvedTransitions.every((transition) => result.occurrenceCandidates.some((candidate) => candidate.candidateId === transition.candidateId)));
});

test("cities and annual editions remain separate even when event names match", async (t) => {
  const harness = await createHarness(t);
  const bytes = Buffer.from(`<!doctype html><script type="application/ld+json">${JSON.stringify({
    "@graph": [
      { "@type": "Event", name: "Harbor Lights Tour", edition: "2027", startDate: "2027-08-01", location: { address: { addressLocality: "Portland" } } },
      { "@type": "Event", name: "Harbor Lights Tour", edition: "2027", startDate: "2027-08-01", location: { address: { addressLocality: "Boston" } } },
      { "@type": "Event", name: "Harbor Lights Tour", edition: "2028", startDate: "2028-08-01", location: { address: { addressLocality: "Boston" } } },
    ],
  })}</script>`);
  const result = await composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit()));

  assert.equal(result.occurrenceCandidates.length, 3);
  assert.equal(result.occurrenceDecisions.length, 3);
  assert.ok(result.occurrenceDecisions.every((decision) => decision.relation === "different_occurrence_candidate"));
  assert.ok(result.occurrenceDecisions.some((decision) => decision.conflictFields.includes("city")));
  assert.ok(result.occurrenceDecisions.some((decision) => decision.conflictFields.includes("edition") && decision.conflictFields.includes("start")));
});

test("separate JSON-LD scripts retain block identity across events, organizations, and transitions", async (t) => {
  const harness = await createHarness(t);
  const bytes = jsonLdScripts([
    { "@graph": [
      { "@type": "Event", name: "Harbor Lights Tour", startDate: "2027-08-01", location: { address: { addressLocality: "Boston" } } },
      { "@type": "Event", name: "Night Market", startDate: "2027-09-10", eventStatus: "https://schema.org/EventCancelled" },
      { "@type": "Organization", name: "Harbor Arts Center" },
    ] },
    { "@graph": [
      { "@type": "Event", name: "Harbor Lights Tour", startDate: "2027-08-01", location: { address: { addressLocality: "Portland" } } },
      { "@type": "Event", name: "Night Market replacement", startDate: "2027-09-11", eventStatus: "https://schema.org/EventRescheduled" },
      { "@type": "Organization", name: "Harbor Arts Collective" },
    ] },
  ]);
  const result = await composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit()));
  const extractedEvents = result.sources[0].extraction.events;

  assert.deepEqual(extractedEvents.map(({ entityId, ordinal, blockIndex }) => [entityId, ordinal, blockIndex]), [
    ["event:script-0:/@graph/0", 0, 0],
    ["event:script-0:/@graph/1", 1, 0],
    ["event:script-1:/@graph/0", 0, 1],
    ["event:script-1:/@graph/1", 1, 1],
  ]);
  assert.deepEqual(result.sources[0].extraction.organizations.map(({ entityId, ordinal, blockIndex }) => [entityId, ordinal, blockIndex]), [
    ["organization:script-0:/@graph/2", 0, 0],
    ["organization:script-1:/@graph/2", 0, 1],
  ]);

  assert.equal(result.occurrenceCandidates.length, 4);
  assert.equal(result.entityCandidates.length, 2);
  assert.equal(result.occurrenceDecisions.length, 6);
  assert.equal(result.entityDecisions.length, 1);
  assert.deepEqual(result.occurrenceCandidates.filter((candidate) => candidate.facts.title[0].value === "Harbor Lights Tour")
    .map((candidate) => candidate.facts.city[0].value).sort(), ["Boston", "Portland"]);
  assert.deepEqual(result.entityCandidates.map((candidate) => candidate.names[0].value).sort(), [
    "Harbor Arts Center",
    "Harbor Arts Collective",
  ]);
  assert.equal(result.entityDecisions[0].relation, "review");
  assert.ok(result.entityDecisions[0].reasonCodes.includes("name_similarity_without_strong_identity"));

  const candidateIds = [
    ...result.entityCandidates.map((candidate) => candidate.candidateId),
    ...result.occurrenceCandidates.map((candidate) => candidate.candidateId),
  ];
  assert.equal(new Set(candidateIds).size, candidateIds.length);
  for (const transition of result.unresolvedTransitions) {
    const candidate = result.occurrenceCandidates.find((entry) => entry.candidateId === transition.candidateId);
    assert.ok(candidate);
    assert.equal(candidate.facts.status[0].value, transition.transition);
  }
  assert.deepEqual(result.unresolvedTransitions.map(({ transition }) => transition).sort(), ["canceled", "rescheduled"]);
  assert.deepEqual(result.transitionLinks, []);

  const fullHash = digest(bytes);
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const evidence = await harness.store.lookupEvidence(scope, result.sources[0].evidence.evidenceId);
  const positions = await harness.store.listEvidencePositions(scope, evidence, request());
  for (const candidate of result.occurrenceCandidates) {
    for (const claims of Object.values(candidate.facts)) {
      for (const claim of claims) {
        const [support] = claim.supports;
        assert.equal(support.contentHash, fullHash);
        assert.equal(support.locator.kind, "text-range");
        const rawBytes = bytes.subarray(support.locator.startByte, support.locator.endByte);
        assert.ok(result.facts.some((fact) => fact.field === support.field && fact.rawValue === rawBytes.toString("utf8")
          && fact.supports[0].contentHash === fullHash));
        const storedPosition = positions.find((position) => position.locator.kind === "text-range"
          && position.locator.startByte === support.locator.startByte
          && position.locator.endByte === support.locator.endByte);
        assert.ok(storedPosition);
        assert.equal(storedPosition.contentHash, digest(rawBytes));
        assert.notEqual(storedPosition.contentHash, fullHash);
      }
    }
  }
});

test("separate equal-byte sources stay duplicate evidence with unknown independence", async (t) => {
  const harness = await createHarness(t);
  const bytes = Buffer.from(`<!doctype html><script type="application/ld+json">${JSON.stringify({
    "@type": "Event",
    name: "Open Data Night",
    startDate: "2027-06-20",
  })}</script>`);
  const first = document(bytes, "https://one.example.test/event");
  const second = document(bytes, "https://two.example.test/event");
  const result = await composeSourceIdentity({
    sources: [
      { document: first, retentionHandle: harness.createPermit() },
      { document: second, retentionHandle: harness.createPermit() },
    ],
    request: request(),
    evidenceStore: harness.store,
  });

  assert.equal(result.sources[0].evidence.contentHash, result.sources[1].evidence.contentHash);
  assert.notEqual(result.sources[0].evidence.evidenceId, result.sources[1].evidence.evidenceId);
  assert.equal(result.sources[0].evidence.duplicateGroupId, result.sources[1].evidence.duplicateGroupId);
  assert.equal(result.occurrenceDecisions.length, 1);
  assert.notEqual(result.occurrenceCandidates[0].candidateId, result.occurrenceCandidates[1].candidateId);
  assert.equal(result.occurrenceDecisions[0].relation, "review");
  assert.deepEqual(result.occurrenceDecisions[0].duplicateContentHashes, [digest(bytes)]);
  assert.ok(result.facts.every((fact) => fact.supports.every((support) => support.independence === "unknown")));
});

test("idempotent evidence replay fails closed when exact positions are missing or ambiguous", async (t) => {
  const bytes = await fixture("multi-event.html");
  const doc = document(bytes);
  const extracted = await extractDeterministically(doc);
  const firstCandidate = extracted.events[0].candidates.find((candidate) => candidate.field === "name");
  const selected = firstCandidate.source.locator;

  const missing = await createHarness(t);
  const missingScope = await missing.store.scopeForAuthenticatedRequest(request());
  await missing.store.ingestEvidence(missingScope, {
    sourceUrl: doc.url,
    content: bytes,
    contentType: doc.contentType,
    retrievedAt: doc.fetchedAt,
    sourceKind: "external",
    positions: [{ locator: { kind: "text-range", startByte: 0, endByte: 1 }, content: bytes.subarray(0, 1) }],
    retentionHandle: missing.createPermit(),
  });
  await expectCompositionError(
    composeSourceIdentity(sourceInput(missing.store, doc, missing.createPermit())),
    "EVIDENCE_POSITION_MISSING",
  );

  const ambiguous = await createHarness(t);
  const ambiguousScope = await ambiguous.store.scopeForAuthenticatedRequest(request());
  const candidateBytes = bytes.subarray(selected.startByte, selected.endByte);
  await ambiguous.store.ingestEvidence(ambiguousScope, {
    sourceUrl: doc.url,
    content: bytes,
    contentType: doc.contentType,
    retrievedAt: doc.fetchedAt,
    sourceKind: "external",
    positions: [
      { locator: selected, content: candidateBytes },
      { locator: selected, content: candidateBytes },
    ],
    retentionHandle: ambiguous.createPermit(),
  });
  await expectCompositionError(
    composeSourceIdentity(sourceInput(ambiguous.store, doc, ambiguous.createPermit())),
    "EVIDENCE_POSITION_AMBIGUOUS",
  );
});

test("idempotent replay binds facts through the store's actual reversed position set", async (t) => {
  const harness = await createHarness(t);
  const bytes = await fixture("multi-event.html");
  const doc = document(bytes);
  const extracted = await extractDeterministically(doc);
  const supportedFields = new Set([
    "name", "series", "seriesName", "edition", "eventEdition", "location.address.addressLocality",
    "location.name", "startDate", "endDate", "eventStatus",
  ]);
  const positionMap = new Map();
  for (const entity of [...extracted.events, ...extracted.organizations]) {
    for (const candidate of entity.candidates) {
      if (candidate.suggestionOnly === true || !supportedFields.has(candidate.field)) continue;
      const locator = candidate.source.locator;
      const key = JSON.stringify([locator.kind, locator.startByte, locator.endByte]);
      positionMap.set(key, { locator, content: bytes.subarray(locator.startByte, locator.endByte) });
    }
  }
  for (const candidate of [
    ...extracted.canonicalSuggestions,
    ...extracted.pageMetadata.filter((candidate) => candidate.field === "openGraph.url"),
  ]) {
    if (typeof candidate.urlSuggestion !== "string") continue;
    const locator = candidate.source.locator;
    const key = JSON.stringify([locator.kind, locator.startByte, locator.endByte]);
    positionMap.set(key, { locator, content: bytes.subarray(locator.startByte, locator.endByte) });
  }
  const originalPositions = [...positionMap.values()];
  assert.ok(originalPositions.length > 1);
  const reversedPositions = [...originalPositions].reverse();
  const seedScope = await harness.store.scopeForAuthenticatedRequest(request());
  const seeded = await harness.store.ingestEvidence(seedScope, {
    sourceUrl: doc.url,
    content: bytes,
    contentType: doc.contentType,
    retrievedAt: doc.fetchedAt,
    sourceKind: "external",
    positions: reversedPositions,
    retentionHandle: harness.createPermit(),
  });

  const handleLocators = new WeakMap();
  const selectedSnapshots = [];
  const factSupportLocators = [];
  const observedStore = Object.create(null);
  for (const method of ["scopeForAuthenticatedRequest", "ingestEvidence", "appendFact", "materializeSelected"]) {
    observedStore[method] = harness.store[method].bind(harness.store);
  }
  observedStore.materializeSelected = async (scope, selection, authenticatedRequest, signal) => {
    const selected = await harness.store.materializeSelected(scope, selection, authenticatedRequest, signal);
    const currentLocators = [];
    for (const evidence of selected.evidence) {
      for (const position of evidence.positions) {
        const locator = Object.freeze({ ...position.locator });
        currentLocators.push(locator);
        handleLocators.set(position.handle, locator);
      }
    }
    selectedSnapshots.push({ facts: selected.facts.length, locators: currentLocators });
    return selected;
  };
  observedStore.appendFact = async (scope, fact, authenticatedRequest) => {
    const support = fact.supports[0];
    factSupportLocators.push({ field: fact.field, rawValue: fact.rawValue, locator: handleLocators.get(support.position) });
    return harness.store.appendFact(scope, fact, authenticatedRequest);
  };

  const result = await composeSourceIdentity({
    sources: [{ document: doc, retentionHandle: harness.createPermit() }],
    request: request(),
    evidenceStore: observedStore,
  });
  const expectedStoreOrder = reversedPositions.map(({ locator }) => locator);
  assert.deepEqual(selectedSnapshots.map((snapshot) => snapshot.locators), [expectedStoreOrder, expectedStoreOrder]);
  assert.deepEqual(selectedSnapshots.map((snapshot) => snapshot.facts), [0, result.facts.length]);
  assert.equal(result.sources[0].evidence.evidenceId, seeded.metadata.evidenceId);
  assert.equal(factSupportLocators.length, result.facts.length);
  for (const factSupport of factSupportLocators) {
    assert.ok(factSupport.locator);
    assert.ok([...extracted.events, ...extracted.organizations].some((entity) => entity.candidates.some((candidate) =>
      candidate.field === factSupport.field && candidate.rawValue === factSupport.rawValue
      && candidate.source.locator.kind === factSupport.locator.kind
      && candidate.source.locator.startByte === factSupport.locator.startByte
      && candidate.source.locator.endByte === factSupport.locator.endByte)));
  }
});

test("denied, expired, and changed-tenant evidence never returns identity observations", async (t) => {
  const bytes = await fixture("multi-event.html");
  const denied = await createHarness(t);
  await expectCompositionError(
    composeSourceIdentity(sourceInput(denied.store, document(bytes), denied.createPermit(), request("tenant-a", false))),
    "EVIDENCE_DENIED",
  );

  const expired = await createHarness(t, {
    authorizePrivateAccess({ action, tenantId, request: authenticatedRequest }) {
      if (action === "materialize_selected") expired.clock.value += 2_000;
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
  });
  await expectCompositionError(
    composeSourceIdentity(sourceInput(expired.store, document(bytes), expired.createPermit("tenant-a", 1_000))),
    "EVIDENCE_EXPIRED",
  );

  const changed = await createHarness(t, {
    authorizePrivateAccess({ action, tenantId, request: authenticatedRequest }) {
      if (action === "materialize_selected") authenticatedRequest.principal.tenantId = "tenant-b";
      return authenticatedRequest?.principal?.tenantId === tenantId || action === "materialize_selected";
    },
  });
  const changingRequest = request();
  await expectCompositionError(
    composeSourceIdentity(sourceInput(changed.store, document(bytes), changed.createPermit(), changingRequest)),
    "EVIDENCE_DENIED",
  );
});

test("replay reports immutable stored provenance separately from the current retrieval observation", async (t) => {
  const harness = await createHarness(t);
  const bytes = await fixture("multi-event.html");
  const oldRetrievedAt = new Date(harness.clock.value - 30_000).toISOString();
  const currentRetrievedAt = new Date(harness.clock.value).toISOString();
  const firstDocument = { ...document(bytes), fetchedAt: oldRetrievedAt };
  const first = await composeSourceIdentity(sourceInput(harness.store, firstDocument, harness.createPermit()));
  const replayDocument = { ...document(bytes), fetchedAt: currentRetrievedAt };
  const replay = await composeSourceIdentity(sourceInput(harness.store, replayDocument, harness.createPermit()));

  assert.equal(replay.sources[0].evidence.evidenceId, first.sources[0].evidence.evidenceId);
  assert.deepEqual(replay.occurrenceCandidates.map(({ candidateId }) => candidateId),
    first.occurrenceCandidates.map(({ candidateId }) => candidateId));
  assert.deepEqual(replay.entityCandidates.map(({ candidateId }) => candidateId),
    first.entityCandidates.map(({ candidateId }) => candidateId));
  assert.equal(replay.sources[0].evidence.retrievedAt, oldRetrievedAt);
  assert.equal(replay.sources[0].storedSource.retrievedAt, oldRetrievedAt);
  assert.equal(replay.sources[0].observedRetrievedAt, currentRetrievedAt);
  assert.equal(replay.sources[0].extraction.source.fetchedAt, currentRetrievedAt);
  assert.equal(first.sources[0].storedSource.retrievedAt, oldRetrievedAt, "replay leaves the first result immutable");
  assert.ok(Object.isFrozen(replay));
  assert.ok(Object.isFrozen(replay.sources[0].storedSource));
  assert.ok(Object.isFrozen(replay.sources[0].storedSource.redirectChain));
});

test("stored URL and content-type mismatches stop before any sourced fact is appended", async (t) => {
  const bytes = await fixture("multi-event.html");
  const mismatches = [
    { label: "URL descriptor", storedUrl: "https://events.example.test/calendar#stored", contentType: "text/html; charset=utf-8", currentUrl: "https://events.example.test/calendar#current" },
    { label: "content type", storedUrl: "https://events.example.test/calendar", contentType: "text/html", currentUrl: "https://events.example.test/calendar" },
  ];
  for (const mismatch of mismatches) {
    const harness = await createHarness(t);
    const extracted = await extractDeterministically(document(bytes));
    const selected = new Map();
    for (const entity of [...extracted.events, ...extracted.organizations]) {
      for (const candidate of entity.candidates) {
        if (candidate.suggestionOnly === true || typeof candidate.rawValue !== "string") continue;
        const locator = candidate.source.locator;
        selected.set(JSON.stringify([locator.kind, locator.startByte, locator.endByte]), {
          locator,
          content: bytes.subarray(locator.startByte, locator.endByte),
        });
      }
    }
    const scope = await harness.store.scopeForAuthenticatedRequest(request());
    await harness.store.ingestEvidence(scope, {
      sourceUrl: mismatch.storedUrl,
      content: bytes,
      contentType: mismatch.contentType,
      retrievedAt: document(bytes).fetchedAt,
      sourceKind: "external",
      positions: [...selected.values()],
      retentionHandle: harness.createPermit(),
    });
    const before = await harness.store.integritySnapshot(scope);
    const current = { ...document(bytes), url: mismatch.currentUrl };
    await expectCompositionError(
      composeSourceIdentity(sourceInput(harness.store, current, harness.createPermit())),
      "STORED_SOURCE_MISMATCH",
    );
    const after = await harness.store.integritySnapshot(scope);
    assert.equal(after.availableFacts, before.availableFacts, `${mismatch.label} is checked before fact writes`);
  }
});

test("a malformed raw position locator retains the stored-source mismatch error", async (t) => {
  const harness = await createHarness(t);
  const bytes = await fixture("multi-event.html");
  const storeView = Object.create(null);
  for (const method of ["scopeForAuthenticatedRequest", "ingestEvidence", "appendFact"]) {
    storeView[method] = harness.store[method].bind(harness.store);
  }
  storeView.materializeSelected = async (scope, selection, authenticatedRequest, signal) => {
    const selected = await harness.store.materializeSelected(scope, selection, authenticatedRequest, signal);
    if (selection.facts.length !== 0 || selected.evidence.length === 0) return selected;
    const first = selected.evidence[0];
    return Object.freeze({
      evidence: Object.freeze([Object.freeze({
        ...first,
        positions: Object.freeze(first.positions.map((position, index) => index === 0
          ? Object.freeze({ ...position, locator: Object.freeze({ kind: "pdf-text-box" }) }) : position)),
      })]),
      facts: selected.facts,
    });
  };

  await expectCompositionError(
    composeSourceIdentity(sourceInput(storeView, document(bytes), harness.createPermit())),
    "STORED_SOURCE_MISMATCH",
  );
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  assert.equal((await harness.store.integritySnapshot(scope)).availableFacts, 0,
    "malformed stored positions fail before fact writes");
});

test("a customer-supplied stored descriptor cannot be reused for external source claims", async (t) => {
  const harness = await createHarness(t);
  const bytes = await fixture("multi-event.html");
  const doc = document(bytes);
  const extracted = await extractDeterministically(doc);
  const selected = new Map();
  for (const entity of [...extracted.events, ...extracted.organizations]) {
    for (const candidate of entity.candidates) {
      if (candidate.suggestionOnly === true || typeof candidate.rawValue !== "string") continue;
      const locator = candidate.source.locator;
      selected.set(JSON.stringify([locator.kind, locator.startByte, locator.endByte]), {
        locator,
        content: bytes.subarray(locator.startByte, locator.endByte),
      });
    }
  }
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const seeded = await harness.store.ingestEvidence(scope, {
    sourceUrl: doc.url,
    content: bytes,
    contentType: doc.contentType,
    retrievedAt: doc.fetchedAt,
    sourceKind: "customer_supplied",
    positions: [...selected.values()],
    retentionHandle: harness.createPermit(),
  });
  let appendCalls = 0;
  const storeView = Object.create(null);
  storeView.scopeForAuthenticatedRequest = harness.store.scopeForAuthenticatedRequest.bind(harness.store);
  storeView.ingestEvidence = async () => seeded;
  storeView.appendFact = (...args) => {
    appendCalls += 1;
    return harness.store.appendFact(...args);
  };
  storeView.materializeSelected = harness.store.materializeSelected.bind(harness.store);

  await expectCompositionError(
    composeSourceIdentity(sourceInput(storeView, doc, harness.createPermit())),
    "STORED_SOURCE_MISMATCH",
  );
  assert.equal(appendCalls, 0);
  assert.equal((await harness.store.integritySnapshot(scope)).availableFacts, 0);
});

test("final aggregate decrypt rechecks changed tenant and ACL before returning", async (t) => {
  const bytes = await fixture("multi-event.html");
  for (const change of ["tenant", "acl"]) {
    const authenticatedRequest = request();
    let selectedCalls = 0;
    let finalFactKeyCalls = 0;
    const harness = await createHarness(t, {
      authorizePrivateAccess({ tenantId, request: candidate, action }) {
        if (action === "materialize_selected") selectedCalls += 1;
        return candidate?.principal?.tenantId === tenantId && candidate.allowPrivate === true;
      },
      resolveKey({ tenantId, purpose, keyId }) {
        const expectedId = `${purpose}-test-v1`;
        if (keyId && keyId !== expectedId) throw new Error("KEY-CANARY-SHOULD-NOT-ESCAPE");
        if (selectedCalls >= 2 && purpose === "fact" && finalFactKeyCalls++ === 0) {
          if (change === "tenant") authenticatedRequest.principal.tenantId = "tenant-b";
          else authenticatedRequest.allowPrivate = false;
        }
        return { keyId: expectedId, key: createHash("sha256").update(`${tenantId}:${purpose}:test-key`).digest() };
      },
    });
    await expectCompositionError(
      composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit(), authenticatedRequest)),
      "EVIDENCE_DENIED",
    );
    assert.equal(selectedCalls, 2, "the change happened while the final aggregate was decrypting facts");
    assert.ok(finalFactKeyCalls > 0);
  }
});

test("terminal selected snapshot denies Promise-valued host authorization", async (t) => {
  const bytes = await fixture("multi-event.html");
  let currentChecks = 0;
  const harness = await createHarness(t, {
    authorizePrivateAccessCurrent({ tenantId, request: authenticatedRequest }) {
      currentChecks += 1;
      if (currentChecks === 2) return Promise.resolve(true);
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
  });
  await expectCompositionError(
    composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit())),
    "EVIDENCE_DENIED",
  );
  assert.equal(currentChecks, 2);
});

test("the synchronous terminal host hook can revoke access immediately before release", async (t) => {
  const bytes = await fixture("multi-event.html");
  let currentChecks = 0;
  const authenticatedRequest = request();
  const harness = await createHarness(t, {
    authorizePrivateAccessCurrent({ tenantId, request: candidate }) {
      currentChecks += 1;
      if (currentChecks === 2) candidate.principal.tenantId = "tenant-b";
      return candidate?.principal?.tenantId === tenantId && candidate.allowPrivate === true;
    },
  });
  await expectCompositionError(
    composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit(), authenticatedRequest)),
    "EVIDENCE_DENIED",
  );
  assert.equal(currentChecks, 2);
});

test("no store or host method runs after successful terminal materialization", async (t) => {
  const harness = await createHarness(t);
  const calls = [];
  const storeView = Object.create(null);
  for (const name of ["scopeForAuthenticatedRequest", "ingestEvidence", "appendFact", "materializeSelected"]) {
    storeView[name] = (...args) => {
      calls.push(name);
      return harness.store[name](...args);
    };
  }
  const bytes = await fixture("multi-event.html");
  const result = await composeSourceIdentity(sourceInput(storeView, document(bytes), harness.createPermit()));
  assert.ok(result.facts.length > 0);
  assert.equal(calls.filter((name) => name === "materializeSelected").length, 2);
  assert.equal(calls.at(-1), "materializeSelected");
});

test("cancellation while the terminal store decrypts returns no identity result", async (t) => {
  const bytes = await fixture("multi-event.html");
  let selectedCalls = 0;
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const blocked = new Promise((resolve) => { releaseResolve = resolve; });
  let blockedOnce = false;
  const harness = await createHarness(t, {
    authorizePrivateAccess({ tenantId, request: candidate, action }) {
      if (action === "materialize_selected") selectedCalls += 1;
      return candidate?.principal?.tenantId === tenantId && candidate.allowPrivate === true;
    },
    async resolveKey({ tenantId, purpose, keyId }) {
      const expectedId = `${purpose}-test-v1`;
      if (keyId && keyId !== expectedId) throw new Error("KEY-CANARY-SHOULD-NOT-ESCAPE");
      if (selectedCalls >= 2 && purpose === "fact" && !blockedOnce) {
        blockedOnce = true;
        enteredResolve();
        await blocked;
      }
      return { keyId: expectedId, key: createHash("sha256").update(`${tenantId}:${purpose}:test-key`).digest() };
    },
  });
  let batchCount = 0;
  let terminalBatchDoneResolve;
  const terminalBatchDone = new Promise((resolve) => { terminalBatchDoneResolve = resolve; });
  const storeView = Object.create(null);
  for (const name of ["scopeForAuthenticatedRequest", "ingestEvidence", "appendFact"]) {
    storeView[name] = harness.store[name].bind(harness.store);
  }
  storeView.materializeSelected = async (...args) => {
    batchCount += 1;
    try { return await harness.store.materializeSelected(...args); }
    finally { if (batchCount === 2) terminalBatchDoneResolve(); }
  };
  const controller = new AbortController();
  const pending = composeSourceIdentity({
    ...sourceInput(storeView, document(bytes), harness.createPermit()),
    signal: controller.signal,
  });
  await entered;
  controller.abort();
  await expectCompositionError(pending, "CANCELED");
  releaseResolve();
  await terminalBatchDone;
});

test("the composition deadline returns while a terminal host key callback remains pending", async (t) => {
  const bytes = await fixture("multi-event.html");
  let selectedCalls = 0;
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const blocked = new Promise((resolve) => { releaseResolve = resolve; });
  let blockedOnce = false;
  const harness = await createHarness(t, {
    authorizePrivateAccess({ tenantId, request: candidate, action }) {
      if (action === "materialize_selected") selectedCalls += 1;
      return candidate?.principal?.tenantId === tenantId && candidate.allowPrivate === true;
    },
    async resolveKey({ tenantId, purpose, keyId }) {
      const expectedId = `${purpose}-test-v1`;
      if (keyId && keyId !== expectedId) throw new Error("KEY-CANARY-SHOULD-NOT-ESCAPE");
      if (selectedCalls >= 2 && purpose === "fact" && !blockedOnce) {
        blockedOnce = true;
        enteredResolve();
        await blocked;
      }
      return { keyId: expectedId, key: createHash("sha256").update(`${tenantId}:${purpose}:test-key`).digest() };
    },
  });
  let batchCount = 0;
  let terminalBatchDoneResolve;
  const terminalBatchDone = new Promise((resolve) => { terminalBatchDoneResolve = resolve; });
  const storeView = Object.create(null);
  for (const name of ["scopeForAuthenticatedRequest", "ingestEvidence", "appendFact"]) {
    storeView[name] = harness.store[name].bind(harness.store);
  }
  storeView.materializeSelected = async (...args) => {
    batchCount += 1;
    try { return await harness.store.materializeSelected(...args); }
    finally { if (batchCount === 2) terminalBatchDoneResolve(); }
  };
  const pending = composeSourceIdentity(sourceInput(storeView, document(bytes), harness.createPermit()));
  await entered;
  await expectCompositionError(pending, "DEADLINE_EXCEEDED");
  releaseResolve();
  await terminalBatchDone;
});

test("terminal aggregate checks earlier fact and source retention using the store clock", async (t) => {
  const bytes = await fixture("multi-event.html");

  const factClock = { value: Date.now() };
  let factRetentionCalls = 0;
  let selectedCalls = 0;
  let terminalFactKeyCalls = 0;
  const permitsForFactExpiry = new WeakMap();
  const factExpiry = await createHarness(t, {
    resolveRetention({ kind, nowMs, sourceExpiresAtMs, retentionHandle, tenantId }) {
      if (kind === "evidence") {
        const permit = permitsForFactExpiry.get(retentionHandle);
        if (!permit || permit.tenantId !== tenantId) throw new Error("RETENTION-CANARY-SHOULD-NOT-ESCAPE");
        return { expiresAtMs: permit.expiresAtMs, policyId: "test-private", policyVersion: "1", accessPolicy: "tenant_private" };
      }
      factRetentionCalls += 1;
      return {
        expiresAtMs: factRetentionCalls === 1 ? nowMs + 1_000 : sourceExpiresAtMs ?? nowMs + 60_000,
        policyId: "test-private-fact",
        policyVersion: "1",
        accessPolicy: "tenant_private",
      };
    },
    authorizePrivateAccess({ tenantId, request: candidate, action }) {
      if (action === "materialize_selected") selectedCalls += 1;
      return candidate?.principal?.tenantId === tenantId && candidate.allowPrivate === true;
    },
    resolveKey({ tenantId, purpose, keyId }) {
      const expectedId = `${purpose}-test-v1`;
      if (keyId && keyId !== expectedId) throw new Error("KEY-CANARY-SHOULD-NOT-ESCAPE");
      if (selectedCalls >= 2 && purpose === "fact" && ++terminalFactKeyCalls === 2) factClock.value += 2_000;
      return { keyId: expectedId, key: createHash("sha256").update(`${tenantId}:${purpose}:test-key`).digest() };
    },
  }, { clock: factClock });
  // This fixture capability is bound by the test retention resolver above.
  const factPermit = Object.freeze(Object.create(null));
  permitsForFactExpiry.set(factPermit, { tenantId: "tenant-a", expiresAtMs: factClock.value + 120_000 });
  await expectCompositionError(
    composeSourceIdentity(sourceInput(factExpiry.store, document(bytes), factPermit)),
    "EVIDENCE_EXPIRED",
  );
  assert.ok(terminalFactKeyCalls >= 2);

  const sourceClock = { value: Date.now() };
  let sourceSelectedCalls = 0;
  let terminalPayloadKeyCalls = 0;
  const sourcePermits = new WeakMap();
  const sourceExpiry = await createHarness(t, {
    resolveRetention({ tenantId, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (kind === "fact") return { expiresAtMs: sourceExpiresAtMs ?? nowMs + 60_000, policyId: "test-private-fact", policyVersion: "1", accessPolicy: "tenant_private" };
      const permit = sourcePermits.get(retentionHandle);
      if (!permit || permit.tenantId !== tenantId) throw new Error("RETENTION-CANARY-SHOULD-NOT-ESCAPE");
      return { expiresAtMs: permit.expiresAtMs, policyId: "test-private", policyVersion: "1", accessPolicy: "tenant_private" };
    },
    authorizePrivateAccess({ tenantId, request: candidate, action }) {
      if (action === "materialize_selected") sourceSelectedCalls += 1;
      return candidate?.principal?.tenantId === tenantId && candidate.allowPrivate === true;
    },
    resolveKey({ tenantId, purpose, keyId }) {
      const expectedId = `${purpose}-test-v1`;
      if (keyId && keyId !== expectedId) throw new Error("KEY-CANARY-SHOULD-NOT-ESCAPE");
      if (sourceSelectedCalls >= 2 && purpose === "payload" && ++terminalPayloadKeyCalls === 2) sourceClock.value += 2_000;
      return { keyId: expectedId, key: createHash("sha256").update(`${tenantId}:${purpose}:test-key`).digest() };
    },
  }, { clock: sourceClock });
  const shortPermit = Object.freeze(Object.create(null));
  const longPermit = Object.freeze(Object.create(null));
  sourcePermits.set(shortPermit, { tenantId: "tenant-a", expiresAtMs: sourceClock.value + 1_000 });
  sourcePermits.set(longPermit, { tenantId: "tenant-a", expiresAtMs: sourceClock.value + 120_000 });
  await expectCompositionError(composeSourceIdentity({
    sources: [
      { document: document(bytes, "https://one.example.test/calendar"), retentionHandle: shortPermit },
      { document: document(bytes, "https://two.example.test/calendar"), retentionHandle: longPermit },
    ],
    request: request(),
    evidenceStore: sourceExpiry.store,
  }), "EVIDENCE_EXPIRED");
  assert.ok(terminalPayloadKeyCalls >= 2);
});

test("pre-abort, cancellation after a host await, getters, and caller extraction injection fail closed", async (t) => {
  const bytes = await fixture("multi-event.html");
  const doc = document(bytes);
  const preabortHarness = await createHarness(t);
  const preaborted = new AbortController();
  preaborted.abort();
  await expectCompositionError(
    composeSourceIdentity({ ...sourceInput(preabortHarness.store, doc, preabortHarness.createPermit()), signal: preaborted.signal }),
    "CANCELED",
  );

  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const blocked = new Promise((resolve) => { releaseResolve = resolve; });
  let firstTenant = true;
  const delayed = await createHarness(t, {
    async resolveTenant(authenticatedRequest) {
      if (firstTenant) {
        firstTenant = false;
        enteredResolve();
        await blocked;
      }
      return authenticatedRequest?.principal?.tenantId;
    },
  });
  const controller = new AbortController();
  const pending = composeSourceIdentity({ ...sourceInput(delayed.store, doc, delayed.createPermit()), signal: controller.signal });
  await entered;
  controller.abort();
  releaseResolve();
  await expectCompositionError(pending, "CANCELED");

  const hostileHarness = await createHarness(t);
  const hostileDocument = new Proxy(doc, {
    getOwnPropertyDescriptor() { throw new Error("HOSTILE-CANARY-SHOULD-NOT-ESCAPE"); },
  });
  await expectCompositionError(
    composeSourceIdentity(sourceInput(hostileHarness.store, hostileDocument, hostileHarness.createPermit())),
    "INVALID_INPUT",
  );
  await expectCompositionError(
    composeSourceIdentity({ ...sourceInput(hostileHarness.store, doc, hostileHarness.createPermit()), extraction: { status: "PARTIAL" } }),
    "INVALID_INPUT",
  );
});

test("non-string values and suggestion-only identifiers never become sourced identity claims", async (t) => {
  const harness = await createHarness(t);
  const bytes = Buffer.from(`<!doctype html><script type="application/ld+json">${JSON.stringify({
    "@type": "Event",
    "@id": "https://events.example.test/only-suggestion",
    name: 42,
    startDate: true,
    url: "https://events.example.test/only-suggestion",
  })}</script>`);
  await expectCompositionError(
    composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit())),
    "NO_IDENTITY_CANDIDATES",
  );
});

test("blank identity strings and over-bound dates remain extraction evidence without comparator claims", async (t) => {
  const harness = await createHarness(t);
  const bytes = Buffer.from(`<!doctype html><script type="application/ld+json">${JSON.stringify({
    "@type": "Event",
    name: "   ",
    startDate: "x".repeat(101),
  })}</script>`);
  await expectCompositionError(
    composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit())),
    "NO_IDENTITY_CANDIDATES",
  );
});

test("candidate and pair-comparison limits accept 23 identities and reject 24", async (t) => {
  const harness = await createHarness(t);
  const atLimit = await composeSourceIdentity(sourceInput(harness.store, document(eventGraph(23)), harness.createPermit()));
  assert.equal(atLimit.occurrenceCandidates.length, 23);
  assert.equal(atLimit.occurrenceDecisions.length, 253);
  assert.equal(atLimit.limits.maxComparisons, 256);
  await expectCompositionError(
    composeSourceIdentity(sourceInput(harness.store, document(eventGraph(24)), harness.createPermit())),
    "RESOURCE_LIMIT",
  );
});

test("candidate limits count repeated block-local ordinals as distinct entities", async (t) => {
  const harness = await createHarness(t);
  const atLimit = await composeSourceIdentity(sourceInput(harness.store, document(eventScripts(23)), harness.createPermit()));
  assert.equal(atLimit.occurrenceCandidates.length, 23);
  assert.equal(atLimit.occurrenceDecisions.length, 253);
  assert.equal(new Set(atLimit.occurrenceCandidates.map(({ candidateId }) => candidateId)).size, 23);
  await expectCompositionError(
    composeSourceIdentity(sourceInput(harness.store, document(eventScripts(24)), harness.createPermit())),
    "RESOURCE_LIMIT",
  );
});

test("128 sourced facts and exact positions fit the aggregate boundary; 129 do not", async (t) => {
  const harness = await createHarness(t);
  const atLimit = await composeSourceIdentity(sourceInput(harness.store, document(eventGraph(16, true)), harness.createPermit()));
  assert.equal(atLimit.facts.length, 128);
  assert.equal(atLimit.sources[0].evidence.positionCount, 128);
  await expectCompositionError(
    composeSourceIdentity(sourceInput(harness.store, document(eventGraph(17, true)), harness.createPermit())),
    "RESOURCE_LIMIT",
  );
});

test("source count and byte ceilings fail before extraction or persistence", async (t) => {
  const harness = await createHarness(t);
  const bytes = Buffer.from('<script type="application/ld+json">{"@type":"Event","name":"Night"}</script>');
  const tooMany = Array.from({ length: 9 }, (_, index) => ({
    document: document(bytes, `https://events.example.test/${index}`),
    retentionHandle: harness.createPermit(),
  }));
  await expectCompositionError(composeSourceIdentity({ sources: tooMany, request: request(), evidenceStore: harness.store }), "INVALID_INPUT");

  const tooLargeSource = document(Buffer.alloc(512 * 1024 + 1, 0x20));
  await expectCompositionError(
    composeSourceIdentity(sourceInput(harness.store, tooLargeSource, harness.createPermit())),
    "RESOURCE_LIMIT",
  );
  await expectCompositionError(
    composeSourceIdentity(sourceInput(harness.store, { ...document(bytes), redirects: 1 }, harness.createPermit())),
    "STORED_SOURCE_MISMATCH",
  );

  const padded = Buffer.concat([bytes, Buffer.alloc(500 * 1024, 0x20)]);
  const tooLargeTotal = Array.from({ length: 5 }, (_, index) => ({
    document: document(padded, `https://events.example.test/padded-${index}`),
    retentionHandle: harness.createPermit(),
  }));
  await expectCompositionError(composeSourceIdentity({
    sources: tooLargeTotal,
    request: request(),
    evidenceStore: harness.store,
  }), "RESOURCE_LIMIT");
});

test("candidate values are rebound to real source positions after the composer writes them", async (t) => {
  const harness = await createHarness(t);
  const bytes = await fixture("multi-event.html");
  const doc = document(bytes);
  const result = await composeSourceIdentity(sourceInput(harness.store, doc, harness.createPermit()));
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const evidence = await harness.store.lookupEvidence(scope, result.sources[0].evidence.evidenceId);
  const positions = await harness.store.listEvidencePositions(scope, evidence, request());
  const references = result.occurrenceCandidates.flatMap((candidate) => Object.values(candidate.facts)
    .flatMap((claims) => claims.flatMap((claim) => claim.supports)));
  assert.ok(references.length > 0);
  for (const reference of references) {
    assert.ok(positions.some((position) => position.locator.kind === reference.locator.kind
      && position.locator.startByte === reference.locator.startByte
      && position.locator.endByte === reference.locator.endByte));
  }
});

test("preserves exact original, final, and redirect URLs while binding canonical links to encrypted source positions", async (t) => {
  const harness = await createHarness(t);
  const bytes = Buffer.from(`<!doctype html>
    <link rel="canonical" href="/calendar/canonical">
    <meta property="og:url" content="/calendar/social">
    <script type="application/ld+json">${JSON.stringify({ "@type": "Event", name: "Final Stop" })}</script>`);
  const finalUrl = "https://events.example.test/final/calendar";
  const requestedUrl = "https://events.example.test/start/calendar";
  const redirectChain = [finalUrl];
  const doc = {
    ...document(bytes, finalUrl),
    requestedUrl,
    redirectChain,
    redirects: 1,
  };
  const result = await composeSourceIdentity(sourceInput(harness.store, doc, harness.createPermit()));
  const source = result.sources[0];
  assert.equal(source.storedSource.sourceUrl, requestedUrl);
  assert.equal(source.storedSource.canonicalUrl, finalUrl);
  assert.deepEqual(source.storedSource.redirectChain, redirectChain);
  assert.equal(result.linkCandidates.length, 2);
  assert.deepEqual(result.linkCandidates.map((candidate) => candidate.url).sort(), [
    "https://events.example.test/calendar/canonical",
    "https://events.example.test/calendar/social",
  ]);
  const scope = await harness.store.scopeForAuthenticatedRequest(request());
  const evidence = await harness.store.lookupEvidence(scope, source.evidence.evidenceId);
  const positions = await harness.store.listEvidencePositions(scope, evidence, request());
  for (const { sourceRef, url } of result.linkCandidates) {
    assert.equal(sourceRef.value, url);
    assert.equal(sourceRef.contentHash, digest(bytes));
    const position = positions.find((candidate) => JSON.stringify(candidate.locator) === JSON.stringify(sourceRef.locator));
    assert.ok(position, "the frontier source reference resolves to a real stored position");
    const exact = bytes.subarray(sourceRef.locator.startByte, sourceRef.locator.endByte);
    assert.equal(position.contentHash, digest(exact));
  }
});

test("a real link-only page can continue bounded discovery without inventing facts", async (t) => {
  const harness = await createHarness(t);
  const bytes = Buffer.from('<!doctype html><link rel="canonical" href="https://events.example.test/official">');
  const result = await composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit()));
  assert.equal(result.facts.length, 0);
  assert.equal(result.occurrenceCandidates.length, 0);
  assert.equal(result.linkCandidates.length, 1);
  assert.equal(result.linkCandidates[0].url, "https://events.example.test/official");
  assert.equal(result.linkCandidates[0].sourceRef.field, "canonical.url");
  assert.equal(result.sourceAuthority, "not_evaluated");
});

test("sensitive link targets are omitted from the frontier candidate projection beside real event facts", async (t) => {
  const harness = await createHarness(t);
  const bytes = Buffer.from(`<!doctype html>
    <link rel="canonical" href="https://events.example.test/next?access_token=secret-canary">
    <script type="application/ld+json">${JSON.stringify({ "@type": "Event", name: "Safe sourced event" })}</script>`);
  const result = await composeSourceIdentity(sourceInput(harness.store, document(bytes), harness.createPermit()));
  assert.ok(result.facts.length > 0);
  assert.deepEqual(result.linkCandidates, []);
  assert.equal(result.linkCandidatesOmitted, 1);
  assert.equal(JSON.stringify(result.linkCandidates).includes("secret-canary"), false);
});

test("new composer reopens and reuses an encrypted historical raw evidence record with the prior fact-only position set", async (t) => {
  const harness = await createHarness(t);
  const bytes = await fixture("multi-event.html");
  const doc = document(bytes);
  const extraction = await extractDeterministically(doc);
  const supportedFields = new Set([
    "name", "series", "seriesName", "edition", "eventEdition", "location.address.addressLocality",
    "location.name", "startDate", "endDate", "eventStatus",
  ]);
  const historicalPositions = new Map();
  for (const entity of [...extraction.events, ...extraction.organizations]) {
    for (const candidate of entity.candidates) {
      if (candidate.suggestionOnly === true || !supportedFields.has(candidate.field)
        || typeof candidate.normalizedValue !== "string" || candidate.normalizedValue.trim() === "") continue;
      if (entity.kind === "organization" && candidate.field !== "name") continue;
      const locator = candidate.source.locator;
      const key = JSON.stringify([locator.kind, locator.startByte, locator.endByte]);
      historicalPositions.set(key, { locator, content: bytes.subarray(locator.startByte, locator.endByte) });
    }
  }
  const oldScope = await harness.store.scopeForAuthenticatedRequest(request());
  const historicalRecord = await harness.store.ingestEvidence(oldScope, {
    sourceUrl: doc.url,
    content: bytes,
    contentType: doc.contentType,
    retrievedAt: doc.fetchedAt,
    sourceKind: "external",
    positions: [...historicalPositions.values()],
    retentionHandle: harness.createPermit(),
  });
  const reopenedStore = harness.openStore();
  const result = await composeSourceIdentity(sourceInput(reopenedStore, doc, harness.createPermit()));
  assert.equal(result.sources[0].evidence.evidenceId, historicalRecord.metadata.evidenceId);
  assert.equal(result.sources[0].evidence.positionCount, historicalPositions.size);
  assert.deepEqual(result.linkCandidates, [], "the legacy record lacks the newly indexed canonical position");
  assert.ok(result.linkCandidatesOmitted > 0);
  const after = await reopenedStore.integritySnapshot(await reopenedStore.scopeForAuthenticatedRequest(request()));
  assert.equal(after.availableEvidence, 1);
});

test("new composer reopens an AES record produced by the actual pinned d91 composer and preserves its facts and source version", async (t) => {
  const harness = await createHarness(t);
  const legacyComposer = await loadPinnedLegacyComposer(t);
  const bytes = Buffer.from(`<!doctype html>
    <link rel="canonical" href="https://events.example.test/official">
    <script type="application/ld+json">${JSON.stringify({ "@type": "Event", name: "Pinned legacy event" })}</script>`);
  const oldResult = await legacyComposer.composeSourceIdentity(
    sourceInput(harness.store, document(Buffer.from(bytes)), harness.createPermit()),
  );
  assert.ok(oldResult.facts.length > 0, "the pinned composer must execute its real extraction and fact write path");
  const oldEvidenceId = oldResult.sources[0].evidence.evidenceId;
  const oldScope = await harness.store.scopeForAuthenticatedRequest(request());
  const oldEvidenceHandle = await harness.store.lookupEvidence(oldScope, oldEvidenceId);
  const oldEvidenceMetadata = await harness.store.getEvidenceMetadata(oldScope, oldEvidenceHandle);
  const oldFacts = await harness.store.listFacts(oldScope, request());
  const oldFactsById = new Map(oldFacts.map((fact) => [fact.factId, factFingerprint(fact)]));
  assert.equal(oldFactsById.size, oldFacts.length);
  assert.ok(oldFacts.length > 0);

  const reopenedStore = harness.openStore();
  const reopenedDocument = document(Buffer.from(bytes));
  const newResult = await composeSourceIdentity(sourceInput(reopenedStore, reopenedDocument, harness.createPermit()));
  assert.equal(newResult.sources[0].evidence.evidenceId, oldEvidenceId);
  assert.equal(newResult.sources[0].evidence.positionCount, oldEvidenceMetadata.positionCount);
  assert.deepEqual(newResult.linkCandidates, [], "the new canonical link is omitted because the immutable legacy record has no such position");
  assert.equal(newResult.linkCandidatesOmitted, 1);

  const reopenedScope = await reopenedStore.scopeForAuthenticatedRequest(request());
  const afterEvidenceHandle = await reopenedStore.lookupEvidence(reopenedScope, oldEvidenceId);
  const afterEvidenceMetadata = await reopenedStore.getEvidenceMetadata(reopenedScope, afterEvidenceHandle);
  const afterFacts = await reopenedStore.listFacts(reopenedScope, request());
  const afterFactsById = new Map(afterFacts.map((fact) => [fact.factId, factFingerprint(fact)]));
  assert.equal(afterEvidenceMetadata.version, oldEvidenceMetadata.version, "replay must not rewrite or advance the legacy source record");
  for (const [factId, fingerprint] of oldFactsById) {
    assert.equal(afterFactsById.get(factId), fingerprint, `pinned legacy fact ${factId} remains immutable`);
  }
  assert.ok(afterFacts.length >= oldFacts.length, "the prior encrypted fact history remains available after replay");
  const integrity = await reopenedStore.integritySnapshot(reopenedScope);
  assert.equal(integrity.availableEvidence, 1);
  assert.equal(integrity.availableFacts, afterFacts.length);
});
