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

async function createHarness(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ei-source-identity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const clock = { value: Date.now() };
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

test("idempotent replay binds facts through the store's actual reversed position listing", async (t) => {
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
  const listedSnapshots = [];
  const factSupportLocators = [];
  const observedStore = Object.create(null);
  for (const method of ["scopeForAuthenticatedRequest", "ingestEvidence", "getEvidenceMetadata", "listEvidencePositions", "appendFact", "readFact"]) {
    observedStore[method] = harness.store[method].bind(harness.store);
  }
  observedStore.listEvidencePositions = async (scope, evidence, authenticatedRequest) => {
    const listed = await harness.store.listEvidencePositions(scope, evidence, authenticatedRequest);
    const currentLocators = [];
    for (const position of listed) {
      const locator = Object.freeze({ ...position.locator });
      currentLocators.push(locator);
      handleLocators.set(position.handle, locator);
    }
    listedSnapshots.push(currentLocators);
    return listed;
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
  assert.deepEqual(listedSnapshots, [expectedStoreOrder, expectedStoreOrder]);
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
      if (action === "list_evidence_positions") expired.clock.value += 2_000;
      return authenticatedRequest?.principal?.tenantId === tenantId && authenticatedRequest.allowPrivate === true;
    },
  });
  await expectCompositionError(
    composeSourceIdentity(sourceInput(expired.store, document(bytes), expired.createPermit("tenant-a", 1_000))),
    "EVIDENCE_EXPIRED",
  );

  const changed = await createHarness(t, {
    authorizePrivateAccess({ action, tenantId, request: authenticatedRequest }) {
      if (action === "list_evidence_positions") authenticatedRequest.principal.tenantId = "tenant-b";
      return authenticatedRequest?.principal?.tenantId === tenantId || action === "list_evidence_positions";
    },
  });
  const changingRequest = request();
  await expectCompositionError(
    composeSourceIdentity(sourceInput(changed.store, document(bytes), changed.createPermit(), changingRequest)),
    "EVIDENCE_DENIED",
  );
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
