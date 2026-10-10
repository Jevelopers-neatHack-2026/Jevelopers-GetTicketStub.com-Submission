import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
  const store = createEvidenceStore({
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
  });
  return { directory, store, clock, createPermit };
}

async function fixture(name) {
  return readFile(fileURLToPath(new URL(name, FIXTURES)));
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
