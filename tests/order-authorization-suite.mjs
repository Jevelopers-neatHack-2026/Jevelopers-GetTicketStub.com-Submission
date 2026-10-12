// SIMULATED ONLY. Cases for the development-only TicketStub order-authorization consumer and the dispatch-time revalidation hook.
// Fake issuer, fake HTTP port, no network, no real key. Passing proves this adapter against a model of the protocol and against the
// producer's own pinned verifier. It is not consumer-conformance evidence, not integration with the live issuer, and no scope completion.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import {
  ConnectorError,
  OrderAuthorizationError,
  createConsumerRequestSigner,
  createTicketStubOrderAuthorizationVerifier,
  deriveOrderActionId,
  deriveOrderClaimKey,
  orderAuthorizationConsumerSignature,
  orderClaimLookupBody
} from "../dist/index.js";
import {
  FIXTURE_DIR,
  FakeIssuer,
  PROVIDER_ID,
  ROTATED_TOKEN_KEY,
  TERMS_DIGEST,
  TEST_CONSUMER_KEY,
  authorizationCheck,
  baseTerms,
  content,
  createRuntimeHarness,
  createSecretSource,
  createTermsSource,
  createVerifierHarness,
  envelope,
  fixtureKey,
  makeClock,
  mutateJson,
  pathKind,
  provenance,
  quoteTerms,
  readFixtureJson,
  readFixtureText,
  scope,
  sha256Hex,
  submitCommand,
  tokenRecordOf
} from "./order-authorization-fixtures.mjs";
import {
  ORDER_AUTHORIZATION_SUITE_CASE_IDS,
  parseOrderAuthorizationOutput,
  runOrderAuthorizationTests,
  validOrderAuthorizationRunnerReport
} from "../scripts/run-order-authorization-tests.mjs";
import {
  actionIdOf,
  canonicalJson,
  consumerSignature as oracleConsumerSignature
} from "./fixtures/order-authorization/verify.mjs";

const cases = [];
function add(id, run) {
  cases.push({ id, run });
}

const REJECTED = { status: "rejected" };
const REASONS = ["unknown", "forged", "unsupported_version", "wrong_scope", "changed_terms", "revoked", "expired", "stale_approval", "stale", "not_orderable", "already_claimed", "not_claimed", "idempotency_conflict", "invalid_clock"];
const kinds = (http) => http.calls.map((call) => pathKind(call.path));
const bodies = (http, kind) => http.calls.filter((call) => pathKind(call.path) === kind).map((call) => JSON.parse(call.bodyText));
const claimKeyOf = (http) => bodies(http, "claim")[0].idempotencyKey;
const rejection = (reason, status) => ({
  kind: "replace",
  status: status ?? (reason === "already_claimed" || reason === "idempotency_conflict" ? 409 : 403),
  bodyText: JSON.stringify({ ok: false, status: "rejected", reason, error: { code: "authorization_invalid" } })
});
const claimOf = (parts, token, over) => parts.verifier.verifyAndClaim(authorizationCheck(token, over));

async function expectOrderError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof OrderAuthorizationError);
    assert.equal(error.code, code);
    return true;
  });
}

async function expectConnectorError(promise, code, sideEffectState) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ConnectorError);
    assert.equal(error.code, code);
    if (sideEffectState !== undefined) assert.equal(error.sideEffectState, sideEffectState);
    return true;
  });
}

function forEachCall(parts, assertCall) {
  for (const call of parts.http.calls) assertCall(call, JSON.parse(call.bodyText));
}

// ---- protocol: signing, happy path, identities -------------------------------------------------------------------

add("vector.consumer-signature-and-lookup-body-match-fixture-vector", () => {
  const example = fixtureKey.consumerRequestExample;
  assert.equal(orderAuthorizationConsumerSignature(fixtureKey.consumerKey, example.timestamp, example.method, example.path, example.body), example.signature);
  assert.equal(oracleConsumerSignature(fixtureKey.consumerKey, example.timestamp, example.method, example.path, example.body), example.signature);
  assert.equal(orderClaimLookupBody("acc_FIXTURE_owner1", "stub_fx_1", "claim_FIXTURE_key_K1"), example.body);
});

add("happy.claim-then-revalidate-signs-exact-bytes-and-binds-local-action-id", async () => {
  const parts = createVerifierHarness();
  const token = parts.issuer.issue();
  const result = await claimOf(parts, token);
  const localAction = actionIdOf(scope.tenantId, { kind: "stub", id: scope.projectId }, "fulfillment.submit", "ord_FIXTURE_0001");
  assert.deepEqual(result, { status: "claimed", authorizationId: "oau_SIM_1", actionId: localAction, claimReference: "clm_SIM_1" });
  assert.deepEqual(kinds(parts.http), ["claim", "revalidate"]);
  assert.equal(parts.issuer.commits, 1);
  const exactPaths = { claim: "/api/order-authorizations/claim", revalidate: "/api/order-authorizations/revalidate" };
  forEachCall(parts, (call, body) => {
    assert.equal(call.path, exactPaths[pathKind(call.path)]);
    const timestamp = Number(call.headers["x-ticketstub-consumer-timestamp"]);
    assert.equal(timestamp, parts.clock.now());
    assert.equal(call.headers["x-ticketstub-consumer-signature"], oracleConsumerSignature(TEST_CONSUMER_KEY, timestamp, "POST", call.path, call.bodyText));
    assert.equal(body.token, token);
    assert.equal(body.expect.tenant, scope.tenantId);
    assert.equal(body.expect.project, `stub:${scope.projectId}`);
    assert.equal(body.expect.action, "fulfillment.submit");
    assert.equal(body.expect.provider, "sandbox");
    assert.equal(canonicalJson(body.expect.terms), canonicalJson(baseTerms()));
  });
  assert.equal(bodies(parts.http, "revalidate")[0].expect.claimReference, "clm_SIM_1");
  assert.equal(Object.keys(bodies(parts.http, "claim")[0]).sort().join(), "expect,idempotencyKey,token");
});

add("identity.claim-key-and-action-id-match-the-producer-formulas", async () => {
  const parts = createVerifierHarness();
  await claimOf(parts, parts.issuer.issue());
  const key = claimKeyOf(parts.http);
  const expected = `fcc1:${sha256Hex(canonicalJson({
    v: 1, consumer: "fulfillment-connectors", providerId: PROVIDER_ID, mode: "simulated", tenant: scope.tenantId,
    project: `stub:${scope.projectId}`, action: "fulfillment.submit", orderRef: "ord_FIXTURE_0001"
  }))}`;
  assert.equal(key, expected);
  assert.equal(key.length, 69);
  assert.match(key, /^[A-Za-z0-9_.:-]{8,128}$/);
  assert.equal(deriveOrderClaimKey({ providerId: PROVIDER_ID, mode: "simulated", tenant: scope.tenantId, projectId: scope.projectId, orderRef: "ord_FIXTURE_0001" }), key);
  assert.equal(deriveOrderActionId(scope.tenantId, scope.projectId, "ord_FIXTURE_0001"), content.actionId);
  assert.equal(deriveOrderActionId(scope.tenantId, scope.projectId, "ord_FIXTURE_0001"), parts.issuer.records.get("oau_SIM_1").record.actionId);
});

// ---- trusted terms ----------------------------------------------------------------------------------------------

add("terms.envelope-terms-and-tampered-token-are-ignored-and-issuer-rejects", async () => {
  const connectorTerms = baseTerms();
  connectorTerms.destination = { ref: "dst_CONNECTOR_ref_9", digest: "9".repeat(64) };
  const parts = createVerifierHarness({ termsOptions: { terms: connectorTerms } });
  const token = parts.issuer.issue();
  const poisoned = { schema: "ticketstub.order-authorization/1", token, terms: baseTerms(), expect: { terms: baseTerms() }, destination: { ref: "dst_FIXTURE_ref_0001" } };
  assert.deepEqual(await claimOf(parts, token, { envelope: poisoned }), REJECTED);
  assert.deepEqual(kinds(parts.http), ["claim"]);
  const sent = bodies(parts.http, "claim")[0];
  assert.equal(canonicalJson(sent.expect.terms), canonicalJson(connectorTerms));
  assert.ok(!parts.http.calls[0].bodyText.includes("dst_FIXTURE_ref_0001"));
  assert.equal(parts.issuer.commits, 0);

  const edited = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  edited.authorization.terms.destination.ref = "dst_CONNECTOR_ref_9";
  const [head, , signature] = token.split(".");
  const tampered = `${head}.${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${signature}`;
  const honest = createVerifierHarness();
  honest.issuer.issue();
  assert.deepEqual(await claimOf(honest, tampered), REJECTED);
  assert.equal(honest.issuer.commits, 0);

  const opaque = createVerifierHarness();
  assert.deepEqual(await claimOf(opaque, "not-a-decodable-token"), REJECTED);
  assert.equal(bodies(opaque.http, "claim")[0].token, "not-a-decodable-token");
});

add("terms.each-missing-or-invalid-binding-is-rejected-without-http", async () => {
  const removals = [
    ["design", (t) => { delete t.design; }], ["destination", (t) => { delete t.destination; }], ["sku", (t) => { delete t.sku; }],
    ["options", (t) => { delete t.options; }], ["approvalId", (t) => { delete t.approvalId; }], ["capabilityVersion", (t) => { delete t.capabilityVersion; }],
    ["orderRef", (t) => { delete t.orderRef; }], ["quote", (t) => { delete t.quote; }], ["design.artHash", (t) => { delete t.design.artHash; }],
    ["destination.digest", (t) => { delete t.destination.digest; }], ["destination.digest-not-hex", (t) => { t.destination.digest = "XYZ"; }],
    ["options.quantity-zero", (t) => { t.options.quantity = 0; }], ["orderRef-malformed", (t) => { t.orderRef = "x y"; }],
    ["sku-number", (t) => { t.sku = 7; }], ["design.versionId-empty", (t) => { t.design.versionId = ""; }]
  ];
  for (const [name, mutate] of removals) {
    const parts = createVerifierHarness({ termsOptions: { mutate } });
    assert.deepEqual(await claimOf(parts, parts.issuer.issue()), REJECTED, name);
    assert.equal(parts.http.calls.length, 0, name);
  }
  const nullSku = createVerifierHarness({ termsOptions: { terms: { ...baseTerms(), sku: null } } });
  assert.equal((await claimOf(nullSku, nullSku.issuer.issue())).status, "claimed");
});

add("terms.non-fixture-provenance-and-source-failures-are-rejected-without-http", async () => {
  const variants = [
    { provenance: { kind: "accepted", digest: TERMS_DIGEST } }, { provenance: { kind: "fixture", digest: TERMS_DIGEST } }, { provenance: { kind: "", digest: TERMS_DIGEST } },
    { provenance: { digest: TERMS_DIGEST } }, { provenance: undefined }, { provenance: null }, { provenance: { kind: "development_fixture", digest: "not-a-digest" } },
    { provenance: { kind: "development_fixture" } }, { behavior: "throw" }, { behavior: "missing" }
  ];
  for (const termsOptions of variants) {
    const parts = createVerifierHarness({ termsOptions });
    assert.deepEqual(await claimOf(parts, parts.issuer.issue()), REJECTED, JSON.stringify(termsOptions));
    assert.equal(parts.http.calls.length, 0);
  }
  for (const resolved of [null, "bound", { status: "bound" }, { status: "bound", terms: baseTerms() }]) {
    const parts = createVerifierHarness({ termsSource: { async resolve() { return resolved; } } });
    assert.deepEqual(await claimOf(parts, parts.issuer.issue()), REJECTED);
    assert.equal(parts.http.calls.length, 0);
  }
});

add("terms.local-quote-amount-and-currency-mismatch-is-rejected-without-http", async () => {
  const token = "unused-token-value";
  const mismatches = [
    { terms: (t) => { t.quote.id = "quote-other"; } },
    { terms: (t) => { t.quote.amountMinor = 1251; } },
    { command: { amountMinor: 1251 } },
    { command: { quote: quoteTerms({ totalMinor: 1251 }) } },
    { terms: (t) => { t.quote.currency = "EUR"; } },
    { command: { currency: "EUR" } },
    { command: { quote: quoteTerms({ currency: "EUR" }) } },
    { command: { quote: quoteTerms({ quoteId: "quote-other" }) } }
  ];
  for (const mismatch of mismatches) {
    const parts = createVerifierHarness({ termsOptions: { mutate: mismatch.terms } });
    assert.deepEqual(await claimOf(parts, token, { command: submitCommand(token, mismatch.command ?? {}) }), REJECTED, JSON.stringify(mismatch.command));
    assert.equal(parts.http.calls.length, 0);
  }
});

// ---- every claimed path ends in revalidate -----------------------------------------------------------------------

add("revalidate.lookup-hit-still-revalidates-under-connector-terms", async () => {
  const parts = createVerifierHarness();
  const token = parts.issuer.issue();
  assert.equal((await claimOf(parts, token)).status, "claimed");
  // The connector's destination now differs. The claim POST never reaches the issuer, so only lookup (which judges the
  // record against ITS OWN terms and says authority.ok) can answer, and only revalidate can notice the difference.
  parts.termsSource.terms.destination = { ref: "dst_CHANGED_ref_0002", digest: "7".repeat(64) };
  parts.http.fault("claim", { kind: "replace", status: 502, bodyText: "bad gateway" });
  parts.http.calls.length = 0;
  assert.deepEqual(await claimOf(parts, token), REJECTED);
  assert.deepEqual(kinds(parts.http), ["claim", "lookup", "revalidate"]);
  const lookup = parts.issuer.lookup({ tenant: scope.tenantId, project: `stub:${scope.projectId}`, idempotencyKey: claimKeyOf(parts.http) }, parts.clock.now());
  assert.equal(JSON.parse(lookup.bodyText).authority.ok, true);

  for (const reason of ["changed_terms", "not_claimed", "revoked"]) {
    const next = createVerifierHarness();
    const nextToken = next.issuer.issue();
    next.http.fault("claim", { kind: "drop-after-commit" });
    next.http.fault("revalidate", rejection(reason));
    assert.deepEqual(await claimOf(next, nextToken), REJECTED, reason);
    assert.deepEqual(kinds(next.http), ["claim", "lookup", "revalidate"]);
  }
});

add("revalidate.replayed-claim-still-revalidates", async () => {
  const parts = createVerifierHarness();
  const token = parts.issuer.issue();
  assert.equal((await claimOf(parts, token)).status, "claimed");
  parts.http.calls.length = 0;
  assert.equal((await claimOf(parts, token)).status, "claimed");
  assert.deepEqual(kinds(parts.http), ["claim", "revalidate"]);
  assert.equal(parts.issuer.replays, 1);
  assert.equal(parts.issuer.commits, 1);
  parts.http.fault("revalidate", rejection("revoked"));
  parts.http.calls.length = 0;
  assert.deepEqual(await claimOf(parts, token), REJECTED);
  assert.deepEqual(kinds(parts.http), ["claim", "revalidate"]);
});

add("revalidate.action-id-mismatch-is-rejected-before-revalidate", async () => {
  const fresh = createVerifierHarness();
  fresh.http.fault("claim", { kind: "mutate", mutate: mutateJson((body) => { body.actionId = "act_00000000000000000000000000000000"; }) });
  assert.deepEqual(await claimOf(fresh, fresh.issuer.issue()), REJECTED);
  assert.deepEqual(kinds(fresh.http), ["claim"]);

  const looked = createVerifierHarness();
  const token = looked.issuer.issue();
  looked.http.fault("claim", { kind: "drop-after-commit" });
  looked.http.fault("lookup", { kind: "mutate", mutate: mutateJson((body) => { body.claim.actionId = "act_ffffffffffffffffffffffffffffffff"; }) });
  assert.deepEqual(await claimOf(looked, token), REJECTED);
  assert.deepEqual(kinds(looked.http), ["claim", "lookup"]);

  const dispatch = createVerifierHarness();
  const dispatchToken = dispatch.issuer.issue();
  const claim = await claimOf(dispatch, dispatchToken);
  assert.deepEqual(await dispatch.verifier.revalidateBeforeDispatch(authorizationCheck(dispatchToken), { ...claim, actionId: "act_ffffffffffffffffffffffffffffffff" }), REJECTED);
});

// ---- ambiguity and reconciliation --------------------------------------------------------------------------------

add("ambiguous.lost-response-reconciles-through-lookup-with-one-key", async () => {
  const parts = createVerifierHarness();
  const token = parts.issuer.issue();
  parts.http.fault("claim", { kind: "drop-after-commit" });
  const result = await claimOf(parts, token);
  assert.equal(result.status, "claimed");
  assert.equal(result.claimReference, "clm_SIM_1");
  assert.deepEqual(kinds(parts.http), ["claim", "lookup", "revalidate"]);
  const key = claimKeyOf(parts.http);
  const [lookup] = bodies(parts.http, "lookup");
  assert.equal(lookup.idempotencyKey, key);
  assert.deepEqual(Object.keys(lookup), ["tenant", "project", "idempotencyKey"]);
  assert.equal(parts.issuer.commits, 1);
  assert.equal(parts.issuer.claimCount(), 1);
});

add("ambiguous.lookup-not-found-retries-once-with-the-same-key", async () => {
  const parts = createVerifierHarness();
  const token = parts.issuer.issue();
  parts.http.fault("claim", { kind: "throw" });
  const result = await claimOf(parts, token);
  assert.equal(result.status, "claimed");
  assert.deepEqual(kinds(parts.http), ["claim", "lookup", "claim", "revalidate"]);
  const keys = [...bodies(parts.http, "claim").map((body) => body.idempotencyKey), bodies(parts.http, "lookup")[0].idempotencyKey];
  assert.equal(new Set(keys).size, 1);
  assert.equal(parts.issuer.commits, 1);
});

add("ambiguous.authorization-claimed-under-another-key-is-rejected", async () => {
  const parts = createVerifierHarness();
  const token = parts.issuer.issue();
  parts.http.fault("claim", { kind: "throw" });
  parts.http.fault("lookup", { kind: "replace", status: 200, bodyText: JSON.stringify({ ok: true, found: false, authorizationClaimed: true }) });
  assert.deepEqual(await claimOf(parts, token), REJECTED);
  assert.deepEqual(kinds(parts.http), ["claim", "lookup"]);
});

add("ambiguous.second-ambiguity-throws-without-minting-a-new-key", async () => {
  const parts = createVerifierHarness();
  const token = parts.issuer.issue();
  parts.http.fault("claim", { kind: "throw", times: 2 });
  await expectOrderError(claimOf(parts, token), "ambiguous_claim");
  assert.deepEqual(kinds(parts.http), ["claim", "lookup", "claim"]);
  assert.equal(new Set(bodies(parts.http, "claim").map((body) => body.idempotencyKey)).size, 1);
});

add("ambiguous.claim-failure-classification-and-timeout", async () => {
  const committed = ["claim", "lookup", "revalidate"];
  const notCommitted = ["claim", "lookup", "claim", "revalidate"];
  const ambiguous = [
    [{ kind: "throw" }, notCommitted], [{ kind: "status-after-commit", status: 500 }, committed], [{ kind: "status-after-commit", status: 502, bodyText: "<html>" }, committed],
    [{ kind: "status-after-commit", status: 504 }, committed], [{ kind: "status-after-commit", status: 200, bodyText: "<html>not json</html>" }, committed],
    [{ kind: "status-after-commit", status: 200, bodyText: "" }, committed], [{ kind: "replace", status: 500, bodyText: "nothing committed" }, notCommitted]
  ];
  for (const [fault, sequence] of ambiguous) {
    const parts = createVerifierHarness();
    parts.http.fault("claim", fault);
    const result = await claimOf(parts, parts.issuer.issue());
    assert.equal(result.status, "claimed", JSON.stringify(fault));
    assert.deepEqual(kinds(parts.http), sequence, JSON.stringify(fault));
    assert.equal(parts.issuer.commits, 1);
  }
  const timed = createVerifierHarness({ timeoutMs: 20 });
  timed.http.fault("claim", { kind: "timeout" });
  assert.equal((await claimOf(timed, timed.issuer.issue())).status, "claimed");
  assert.deepEqual(kinds(timed.http), ["claim", "lookup", "claim", "revalidate"]);
  assert.equal(timed.http.calls[0].aborted(), true);

  const definitive = createVerifierHarness();
  definitive.http.fault("claim", { kind: "replace", status: 503, bodyText: JSON.stringify({ ok: false, error: { code: "consumer_unavailable" } }) });
  await expectOrderError(claimOf(definitive, definitive.issuer.issue()), "unexpected_status");
  assert.deepEqual(kinds(definitive.http), ["claim"]);
});

add("timeouts.revalidate-and-lookup-time-out-abort-and-throw", async () => {
  const revalidate = createVerifierHarness({ timeoutMs: 20 });
  revalidate.http.fault("revalidate", { kind: "timeout" });
  await expectOrderError(claimOf(revalidate, revalidate.issuer.issue()), "timeout");
  assert.equal(revalidate.http.calls.at(-1).aborted(), true);
  const lookup = createVerifierHarness({ timeoutMs: 20 });
  lookup.http.fault("claim", { kind: "throw" });
  lookup.http.fault("lookup", { kind: "timeout" });
  await expectOrderError(claimOf(lookup, lookup.issuer.issue()), "lookup_unavailable");
  assert.deepEqual(kinds(lookup.http), ["claim", "lookup"]);
  assert.throws(() => createTicketStubOrderAuthorizationVerifier({ termsSource: createTermsSource(), http: lookup.http, signer: lookup.signer, clock: lookup.clock, trustedProviderIds: [PROVIDER_ID], timeoutMs: 0 }), OrderAuthorizationError);
});

// ---- key stability and rotation -----------------------------------------------------------------------------------

add("key.is-deterministic-and-excludes-token-delivery-key-fingerprint-and-secret", async () => {
  const keys = new Set();
  const tokens = new Set();
  for (const [index, variant] of [{ idempotencyKey: "idem-a-0001", requestFingerprint: "sha256:fp-a" }, { idempotencyKey: "idem-b-0002", requestFingerprint: "sha256:fp-b" }].entries()) {
    const parts = createVerifierHarness();
    if (index === 1) parts.issuer.rotateTokenKey(ROTATED_TOKEN_KEY);
    const token = parts.issuer.issue();
    tokens.add(token);
    await claimOf(parts, token, { command: submitCommand(token, variant) });
    keys.add(claimKeyOf(parts.http));
    const key = claimKeyOf(parts.http);
    for (const secret of [token, token.split(".")[2], TEST_CONSUMER_KEY, fixtureKey.key, variant.idempotencyKey, variant.requestFingerprint, parts.http.calls[0].headers["x-ticketstub-consumer-signature"]]) {
      assert.ok(!key.includes(secret));
    }
  }
  assert.equal(tokens.size, 2);
  assert.equal(keys.size, 1);
});

add("key.differs-by-order-tenant-project-provider-and-mode", async () => {
  const base = { providerId: PROVIDER_ID, mode: "simulated", tenant: scope.tenantId, projectId: scope.projectId, orderRef: "ord_FIXTURE_0001" };
  const all = new Set([
    deriveOrderClaimKey(base), deriveOrderClaimKey({ ...base, orderRef: "ord_FIXTURE_0002" }), deriveOrderClaimKey({ ...base, tenant: "acc_OTHER_owner2" }),
    deriveOrderClaimKey({ ...base, projectId: "stub_fx_2" }), deriveOrderClaimKey({ ...base, providerId: "other-provider" }), deriveOrderClaimKey({ ...base, mode: "sandbox" })
  ]);
  assert.equal(all.size, 6);
  const parts = createVerifierHarness({ termsOptions: { terms: baseTerms("ord_FIXTURE_0002") } });
  await claimOf(parts, parts.issuer.issue({ orderRef: "ord_FIXTURE_0002" }));
  assert.equal(claimKeyOf(parts.http), deriveOrderClaimKey({ ...base, orderRef: "ord_FIXTURE_0002" }));
});

add("key.signing-key-rotation-after-lost-committed-response-replays-instead-of-stranding", async () => {
  const parts = createVerifierHarness();
  const first = parts.issuer.issue();
  parts.http.fault("claim", { kind: "drop-after-commit" });
  parts.http.fault("lookup", { kind: "throw" });
  await expectOrderError(claimOf(parts, first), "lookup_unavailable");
  assert.equal(parts.issuer.commits, 1);
  parts.issuer.rotateTokenKey(ROTATED_TOKEN_KEY);
  const rotated = parts.issuer.tokenOf("oau_SIM_1");
  assert.notEqual(rotated, first);
  const result = await claimOf(parts, rotated);
  assert.equal(result.status, "claimed");
  assert.equal(result.claimReference, "clm_SIM_1");
  assert.equal(parts.issuer.commits, 1);
  assert.equal(parts.issuer.replays, 1);
  const claimKeys = new Set(bodies(parts.http, "claim").map((body) => body.idempotencyKey));
  assert.equal(claimKeys.size, 1);
  assert.notEqual(bodies(parts.http, "claim")[0].token, bodies(parts.http, "claim").at(-1).token);
});

// ---- dispatch-time revalidation through the runtime ---------------------------------------------------------------

add("runtime.healthy-submit-revalidates-after-claim-and-before-the-single-dispatch", async () => {
  const h = createRuntimeHarness();
  const token = h.issuer.issue();
  const response = await h.runtime.submit(envelope(submitCommand(token)), scope);
  assert.equal(response.value.providerRequestId, "request-fixture-1");
  assert.deepEqual(h.events.filter((event) => event !== "metering:attempt_prepared" && event !== "metering:provider_accepted"), ["budget", "metering:dispatching", "transport"]);
  assert.deepEqual(kinds(h.http), ["claim", "revalidate", "revalidate"]);
  assert.equal(h.state.transportCalls.length, 1);
});

add("runtime.lapse-during-budget-sends-nothing-and-is-stale-authorization", async () => {
  const lapses = {
    revoked: ({ issuer }) => issuer.revoke("oau_SIM_1"),
    expired: ({ clock }) => { clock.current += 20 * 60_000; },
    "approval-revoked": ({ issuer }) => { issuer.approval = "revoked"; },
    "approval-stale": ({ issuer }) => { issuer.approval = "stale"; },
    "no-longer-orderable": ({ issuer }) => { issuer.orderable = false; }
  };
  for (const [name, lapse] of Object.entries(lapses)) {
    const h = createRuntimeHarness({ onBudget: lapse });
    const token = h.issuer.issue();
    await expectConnectorError(h.runtime.submit(envelope(submitCommand(token)), scope), "stale_authorization", "not_dispatched");
    assert.equal(h.state.transportCalls.length, 0, name);
    assert.equal(h.state.budgetCalls, 1, name);
    const attempt = [...h.state.attempts.values()][0];
    assert.equal(attempt.budgetReservationState, "reserved", name);
    assert.equal(attempt.sideEffectState, "not_dispatched", name);
    assert.deepEqual(kinds(h.http), ["claim", "revalidate", "revalidate"], name);
  }
});

add("runtime.lapse-while-dispatching-metering-is-awaited-sends-nothing-and-keeps-evidence", async () => {
  const lapses = {
    revoked: async ({ issuer }) => { await Promise.resolve(); issuer.revoke("oau_SIM_1"); },
    expired: async ({ clock }) => { await Promise.resolve(); clock.current += 20 * 60_000; },
    "approval-revoked": async ({ issuer }) => { await Promise.resolve(); issuer.approval = "revoked"; }
  };
  for (const [name, lapse] of Object.entries(lapses)) {
    const h = createRuntimeHarness({ onDispatchingMetering: lapse });
    await expectConnectorError(h.runtime.submit(envelope(submitCommand(h.issuer.issue())), scope), "stale_authorization", "not_dispatched");
    assert.equal(h.state.transportCalls.length, 0, name);
    assert.deepEqual(h.state.observations, ["attempt_prepared", "dispatching", "not_dispatched"], name);
    assert.deepEqual(h.events.filter((event) => event !== "metering:attempt_prepared"), ["budget", "metering:dispatching", "metering:not_dispatched"], name);
    assert.deepEqual(kinds(h.http), ["claim", "revalidate", "revalidate"], name);
    const [attempt] = [...h.state.attempts.values()];
    assert.equal(attempt.sideEffectState, "not_dispatched", name);
    assert.equal(attempt.budgetReservationState, "reserved", name);
  }
});

add("runtime.revalidate-failure-or-malformed-answer-is-authorization-unavailable", async () => {
  const unavailable = createRuntimeHarness({ onBudget: ({ http }) => http.fault("revalidate", { kind: "throw" }) });
  await expectConnectorError(unavailable.runtime.submit(envelope(submitCommand(unavailable.issuer.issue())), scope), "authorization_unavailable", "not_dispatched");
  assert.equal(unavailable.state.transportCalls.length, 0);
  const statuses = createRuntimeHarness({ onBudget: ({ http }) => http.fault("revalidate", { kind: "replace", status: 401, bodyText: "{}" }) });
  await expectConnectorError(statuses.runtime.submit(envelope(submitCommand(statuses.issuer.issue())), scope), "authorization_unavailable", "not_dispatched");

  for (const answer of [undefined, null, "dispatchable", { status: "ok" }, { status: "dispatchable " }, {}, () => {}]) {
    const verifier = {
      async verifyAndClaim() { return { status: "claimed", authorizationId: "oau-1", actionId: "act-1", claimReference: "clm-1" }; },
      async revalidateBeforeDispatch() { return answer; }
    };
    const h = createRuntimeHarness({ authorizationVerifier: verifier });
    await expectConnectorError(h.runtime.submit(envelope(submitCommand("t")), scope), "authorization_unavailable", "not_dispatched");
    assert.equal(h.state.transportCalls.length, 0);
  }
  const throwing = createRuntimeHarness({ authorizationVerifier: {
    async verifyAndClaim() { return { status: "claimed", authorizationId: "oau-1", actionId: "act-1", claimReference: "clm-1" }; },
    async revalidateBeforeDispatch() { throw new Error("verifier down: secret-token-material"); }
  } });
  await assert.rejects(throwing.runtime.submit(envelope(submitCommand("t")), scope), (error) => {
    assert.ok(error instanceof ConnectorError);
    assert.equal(error.code, "authorization_unavailable");
    assert.ok(!JSON.stringify(error).includes("secret-token-material") && !error.message.includes("secret-token-material"));
    return true;
  });
});

add("runtime.adapter-retry-revalidates-before-every-transport-request", async () => {
  const healthy = createRuntimeHarness({ transportRequests: 3 });
  await healthy.runtime.submit(envelope(submitCommand(healthy.issuer.issue())), scope);
  assert.equal(healthy.state.transportCalls.length, 3);
  assert.deepEqual(kinds(healthy.http), ["claim", "revalidate", "revalidate", "revalidate", "revalidate"]);

  const lapsing = createRuntimeHarness({ transportRequests: 2 });
  const token = lapsing.issuer.issue();
  const original = lapsing.dependencies.transport.request.bind(lapsing.dependencies.transport);
  lapsing.dependencies.transport.request = async (request) => {
    const answer = await original(request);
    lapsing.issuer.revoke("oau_SIM_1");
    return answer;
  };
  await expectConnectorError(lapsing.runtime.submit(envelope(submitCommand(token)), scope), "stale_authorization", "possible");
  assert.equal(lapsing.state.transportCalls.length, 1);
  assert.deepEqual(kinds(lapsing.http), ["claim", "revalidate", "revalidate", "revalidate"]);
});

add("runtime.verifiers-without-the-method-behave-as-before", async () => {
  let claims = 0;
  for (const revalidateBeforeDispatch of [undefined, "not-a-function", null]) {
    const verifier = { async verifyAndClaim() { claims += 1; return { status: "claimed", authorizationId: `oau-${claims}`, actionId: `act-${claims}`, claimReference: "clm-1" }; } };
    if (revalidateBeforeDispatch !== undefined) verifier.revalidateBeforeDispatch = revalidateBeforeDispatch;
    const h = createRuntimeHarness({ authorizationVerifier: verifier });
    const response = await h.runtime.submit(envelope(submitCommand("t")), scope);
    assert.equal(response.value.providerRequestId, "request-fixture-1");
    assert.equal(h.state.transportCalls.length, 1);
  }
  assert.equal(claims, 3);
});

add("runtime.twelve-delivery-keys-make-one-issuer-claim-and-one-dispatch", async () => {
  const h = createRuntimeHarness();
  const token = h.issuer.issue();
  const settled = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
    h.runtime.submit(envelope(submitCommand(token, { idempotencyKey: `idem-concurrent-${String(index).padStart(2, "0")}`, requestFingerprint: `sha256:fp-${index}` })), scope)));
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  for (const item of settled.filter((candidate) => candidate.status === "rejected")) assert.ok(item.reason instanceof ConnectorError);
  assert.equal(h.state.transportCalls.length, 1);
  assert.equal(h.state.budgetCalls, 1);
  assert.equal(h.issuer.commits, 1);
  assert.equal(h.issuer.claimCount(), 1);
  assert.equal(h.issuer.replays, 11);
  assert.equal(new Set(bodies(h.http, "claim").map((body) => body.idempotencyKey)).size, 1);
});

// ---- protocol responses -------------------------------------------------------------------------------------------

add("responses.every-known-rejection-reason-is-rejected-for-claim-and-revalidate", async () => {
  for (const reason of REASONS) {
    for (const status of [undefined, 403, 409]) {
      const claim = createVerifierHarness();
      claim.http.fault("claim", rejection(reason, status));
      assert.deepEqual(await claimOf(claim, claim.issuer.issue()), REJECTED, `${reason} claim`);
      assert.deepEqual(kinds(claim.http), ["claim"]);
      const revalidate = createVerifierHarness();
      revalidate.http.fault("revalidate", rejection(reason, status));
      assert.deepEqual(await claimOf(revalidate, revalidate.issuer.issue()), REJECTED, `${reason} revalidate`);
    }
  }
});

add("responses.unsafe-statuses-malformed-bodies-and-unknown-reasons-throw", async () => {
  const statuses = [400, 401, 404, 413, 429, 503];
  for (const status of statuses) {
    const claim = createVerifierHarness();
    claim.http.fault("claim", { kind: "replace", status, bodyText: JSON.stringify({ ok: false }) });
    await expectOrderError(claimOf(claim, claim.issuer.issue()), "unexpected_status");
    assert.deepEqual(kinds(claim.http), ["claim"]);
  }
  for (const status of [...statuses, 500, 502, 504]) {
    const revalidate = createVerifierHarness();
    revalidate.http.fault("revalidate", { kind: "replace", status, bodyText: JSON.stringify({ ok: false }) });
    await expectOrderError(claimOf(revalidate, revalidate.issuer.issue()), "unexpected_status");
    const lookup = createVerifierHarness();
    lookup.http.fault("claim", { kind: "throw" });
    lookup.http.fault("lookup", { kind: "replace", status, bodyText: "{}" });
    await expectOrderError(claimOf(lookup, lookup.issuer.issue()), "unexpected_status");
  }
  const malformed = [
    ["claim", { kind: "replace", status: 403, bodyText: "not json" }, "malformed_response"],
    ["claim", { kind: "replace", status: 409, bodyText: "" }, "malformed_response"],
    ["claim", { kind: "replace", status: 403, bodyText: JSON.stringify({ ok: false, status: "rejected", reason: "made_up" }) }, "unknown_rejection"],
    ["claim", { kind: "replace", status: 403, bodyText: JSON.stringify({ ok: false, status: "rejected" }) }, "unknown_rejection"],
    ["claim", { kind: "replace", status: 403, bodyText: JSON.stringify({ ok: true, status: "claimed" }) }, "malformed_response"],
    ["claim", { kind: "replace", status: 200, bodyText: JSON.stringify({ ok: true, status: "claimed", replayed: false }) }, "malformed_response"],
    ["claim", { kind: "replace", status: 200, bodyText: JSON.stringify({ ok: false }) }, "malformed_response"],
    ["claim", { kind: "replace", status: 201, bodyText: "{}" }, "unexpected_status"],
    ["revalidate", { kind: "replace", status: 200, bodyText: "not json" }, "malformed_response"],
    ["revalidate", { kind: "replace", status: 200, bodyText: JSON.stringify({ ok: true, status: "dispatchable" }) }, "malformed_response"],
    ["revalidate", { kind: "replace", status: 200, bodyText: JSON.stringify({ ok: true, status: "other", authorization: {} }) }, "malformed_response"],
    ["revalidate", { kind: "replace", status: 403, bodyText: JSON.stringify({ ok: false, status: "rejected", reason: ["unknown"] }) }, "unknown_rejection"],
    ["revalidate", { kind: "replace", status: 409, bodyText: "<html>" }, "malformed_response"]
  ];
  for (const [kind, fault, code] of malformed) {
    const parts = createVerifierHarness();
    parts.http.fault(kind, fault);
    await expectOrderError(claimOf(parts, parts.issuer.issue()), code);
  }
  for (const bodyText of ["{}", JSON.stringify({ ok: true }), JSON.stringify({ ok: true, found: "yes" }), JSON.stringify({ ok: true, found: true, claim: {} }), JSON.stringify({ ok: true, found: false, authorizationClaimed: "true" }), "nope"]) {
    const parts = createVerifierHarness();
    parts.http.fault("claim", { kind: "throw" });
    parts.http.fault("lookup", { kind: "replace", status: 200, bodyText });
    await expectOrderError(claimOf(parts, parts.issuer.issue()), "malformed_response");
  }
});

add("modes.sandbox-live-prodigi-unmapped-provider-and-cancel-are-refused-before-http", async () => {
  for (const mode of ["sandbox", "live", "", null]) {
    const parts = createVerifierHarness();
    await expectOrderError(claimOf(parts, parts.issuer.issue(), { mode }), "refused_mode");
    assert.equal(parts.http.calls.length, 0);
    assert.equal(parts.termsSource.calls.length, 0);
  }
  for (const providerId of ["prodigi", "unmapped-provider", "", null]) {
    const parts = createVerifierHarness();
    await expectOrderError(claimOf(parts, parts.issuer.issue(), { providerId }), "refused_provider");
    assert.equal(parts.http.calls.length, 0);
  }
  const cancel = createVerifierHarness();
  assert.deepEqual(await claimOf(cancel, cancel.issuer.issue(), { operation: "cancel" }), REJECTED);
  assert.deepEqual(await cancel.verifier.revalidateBeforeDispatch(authorizationCheck("t", { operation: "cancel" }), { status: "claimed", authorizationId: "a", actionId: "b", claimReference: "c" }), REJECTED);
  assert.equal(cancel.http.calls.length, 0);
  for (const envelope of [null, "token", {}, { schema: "other/1", token: "t" }, { schema: "ticketstub.order-authorization/1" }, { schema: "ticketstub.order-authorization/1", token: "" }, { schema: "ticketstub.order-authorization/1", token: 7 }, { schema: "ticketstub.order-authorization/1", token: "x".repeat(8193) }]) {
    const parts = createVerifierHarness();
    assert.deepEqual(await claimOf(parts, "t", { envelope }), REJECTED, JSON.stringify(envelope)?.slice(0, 40));
    assert.equal(parts.http.calls.length, 0);
  }
  const prodigiIssuer = createVerifierHarness({ issuerOptions: { provider: "prodigi" } });
  assert.deepEqual(await claimOf(prodigiIssuer, prodigiIssuer.issuer.issue()), REJECTED);
  assert.ok(prodigiIssuer.http.calls.every((call) => JSON.parse(call.bodyText).expect.provider === "sandbox"));
  const base = createVerifierHarness();
  const good = { termsSource: base.termsSource, http: base.http, signer: base.signer, clock: base.clock, trustedProviderIds: [PROVIDER_ID] };
  assert.ok(createTicketStubOrderAuthorizationVerifier(good));
  for (const bad of [{ termsSource: {} }, { http: {} }, { signer: {} }, { clock: {} }, { trustedProviderIds: [] }, { trustedProviderIds: [""] }, { timeoutMs: 0 }, { timeoutMs: 100000 }]) {
    assert.throws(() => createTicketStubOrderAuthorizationVerifier({ ...good, ...bad }), OrderAuthorizationError);
  }
});

add("records.fixture-live-mode-environment-audience-provider-and-expiry-are-rejected", async () => {
  const variants = {
    "mode fixture": (r) => { r.mode = "fixture"; },
    "mode live": (r) => { r.mode = "live"; },
    "environment live": (r) => { r.environment = "live"; },
    "wrong audience": (r) => { r.audience = "someone-else"; },
    "provider prodigi": (r) => { r.provider = "prodigi"; },
    "expired now": (r, now) => { r.expiresAt = new Date(now).toISOString(); },
    "expired past": (r, now) => { r.expiresAt = new Date(now - 1000).toISOString(); },
    "bad expiry": (r) => { r.expiresAt = "soon"; },
    "wrong schema": (r) => { r.schema = "ticketstub.order-authorization/2"; }
  };
  for (const [name, change] of Object.entries(variants)) {
    const claim = createVerifierHarness();
    claim.http.fault("revalidate", { kind: "mutate", mutate: mutateJson((body) => { change(body.authorization, claim.clock.now()); }) });
    assert.deepEqual(await claimOf(claim, claim.issuer.issue()), REJECTED, name);

    const dispatch = createVerifierHarness();
    const token = dispatch.issuer.issue();
    const claimed = await claimOf(dispatch, token);
    dispatch.http.fault("revalidate", { kind: "mutate", mutate: mutateJson((body) => { change(body.authorization, dispatch.clock.now()); }) });
    assert.deepEqual(await dispatch.verifier.revalidateBeforeDispatch(authorizationCheck(token), claimed), REJECTED, `${name} at dispatch`);
  }

  // The vendored producer fixture token is mode "fixture": the issuer model accepts it, a consumer must not.
  const vendored = readFixtureJson("valid-claim.json");
  const record = tokenRecordOf(vendored.token);
  assert.equal(record.mode, "fixture");
  const clock = makeClock(Date.parse(vendored.verifyAt));
  const issuer = new FakeIssuer({ clock });
  issuer.records.set(record.id, { record, revoked: false, n: 1 });
  const terms = structuredClone(content.terms);
  const parts = createVerifierHarness({ clock, issuer, termsOptions: { terms } });
  const command = submitCommand(vendored.token, { quote: quoteTerms({ quoteId: terms.quote.id, totalMinor: terms.quote.amountMinor, currency: terms.quote.currency, expiresAt: "2026-10-10T13:00:00.000Z" }), amountMinor: terms.quote.amountMinor, currency: terms.quote.currency });
  assert.deepEqual(await claimOf(parts, vendored.token, { command }), REJECTED);
  assert.deepEqual(kinds(parts.http), ["claim", "revalidate"]);
  assert.equal(issuer.commits, 1);
});

add("responses.revalidate-field-bindings-reject-each-mismatch-and-accept-canonical-equality", async () => {
  const mismatches = {
    id: (r) => { r.id = "oau_other"; },
    actionId: (r) => { r.actionId = "act_00000000000000000000000000000000"; },
    tenant: (r) => { r.tenant = { id: "acc_other" }; },
    project: (r) => { r.project = { kind: "stub", id: "stub_other" }; },
    action: (r) => { r.action = "fulfillment.cancel"; },
    "terms.quantity": (r) => { r.terms.options.quantity = 2; },
    "terms.sku": (r) => { r.terms.sku = "SKU-1"; },
    "terms.extra": (r) => { r.terms.address = "none"; },
    "terms.missing": (r) => { delete r.terms.approvalId; },
    terms: (r) => { r.terms = null; }
  };
  for (const [name, change] of Object.entries(mismatches)) {
    const parts = createVerifierHarness();
    parts.http.fault("revalidate", { kind: "mutate", mutate: mutateJson((body) => { change(body.authorization); }) });
    assert.deepEqual(await claimOf(parts, parts.issuer.issue()), REJECTED, name);
  }
  const reordered = createVerifierHarness();
  reordered.http.fault("revalidate", { kind: "mutate", mutate: (response) => {
    const body = JSON.parse(response.bodyText);
    const terms = body.authorization.terms;
    body.authorization.terms = Object.fromEntries(Object.keys(terms).reverse().map((key) => [key, terms[key]]));
    return { status: 200, bodyText: JSON.stringify(body) };
  } });
  assert.equal((await claimOf(reordered, reordered.issuer.issue())).status, "claimed");
});

// ---- signer, redaction, bindings, provenance ---------------------------------------------------------------------

add("signer.refuses-short-and-fixture-keys-and-leases-the-key-on-every-request", async () => {
  const clock = makeClock();
  const make = (secrets, extra = {}) => createConsumerRequestSigner({ source: secrets, providerId: PROVIDER_ID, secretReference: "order-auth-consumer", mode: "simulated", clock, ...extra });
  const input = { method: "POST", path: "/api/order-authorizations/claim", bodyText: "{}" };
  for (const secret of ["", "short-key", "x".repeat(31), fixtureKey.consumerKey, fixtureKey.key, `${"x".repeat(40)}FIXTURE-ONLY`]) {
    await expectOrderError(make(createSecretSource(() => secret)).sign(input), "key_unavailable");
  }
  await expectOrderError(make({ async load() { throw new Error("vault down"); } }).sign(input), "key_unavailable");
  await expectOrderError(make({ async load() { return { secret: TEST_CONSUMER_KEY, version: "v1", mode: "sandbox" }; } }).sign(input), "key_unavailable");

  let current = TEST_CONSUMER_KEY;
  const secrets = createSecretSource(() => current);
  const signer = make(secrets);
  const first = await signer.sign(input);
  assert.equal(first.signature, oracleConsumerSignature(TEST_CONSUMER_KEY, clock.now(), "POST", input.path, input.bodyText));
  current = ROTATED_TOKEN_KEY;
  const second = await signer.sign(input);
  assert.equal(secrets.loads, 2);
  assert.equal(second.signature, oracleConsumerSignature(ROTATED_TOKEN_KEY, clock.now(), "POST", input.path, input.bodyText));
  assert.notEqual(first.signature, second.signature);

  // A rotated key that the issuer has not adopted is a hard cutover: 401 is a throw, and a later retry reconciles with the same claim key.
  const parts = createVerifierHarness({ getSecret: () => current });
  current = ROTATED_TOKEN_KEY;
  await expectOrderError(claimOf(parts, parts.issuer.issue()), "unexpected_status");
  current = TEST_CONSUMER_KEY;
  assert.equal((await claimOf(parts, parts.issuer.tokenOf("oau_SIM_1"))).status, "claimed");
});

add("redaction.errors-results-and-requests-never-expose-secrets-or-addresses", async () => {
  const secrets = [];
  const collect = async (setup, expectCode) => {
    const parts = createVerifierHarness({ timeoutMs: 20 });
    const token = parts.issuer.issue();
    setup(parts);
    let thrown;
    try { await claimOf(parts, token); } catch (error) { thrown = error; }
    assert.ok(thrown instanceof OrderAuthorizationError);
    assert.equal(thrown.code, expectCode);
    const rendered = `${thrown.message}|${thrown.stack}|${JSON.stringify(thrown)}|${String(thrown.cause)}|${Object.keys(thrown).join()}`;
    const claimKey = parts.http.calls.length > 0 && pathKind(parts.http.calls[0].path) === "claim" ? JSON.parse(parts.http.calls[0].bodyText).idempotencyKey : "none-none";
    for (const secret of [token, token.split(".")[1], token.split(".")[2], TEST_CONSUMER_KEY, fixtureKey.key, claimKey, parts.http.calls[0].headers["x-ticketstub-consumer-signature"]]) {
      assert.ok(!rendered.includes(secret));
    }
    secrets.push(rendered);
  };
  await collect((p) => p.http.fault("claim", { kind: "replace", status: 400, bodyText: "token leaked here" }), "unexpected_status");
  await collect((p) => p.http.fault("claim", { kind: "replace", status: 403, bodyText: "oops" }), "malformed_response");
  await collect((p) => p.http.fault("claim", { kind: "throw", times: 2 }), "ambiguous_claim");
  await collect((p) => p.http.fault("revalidate", { kind: "timeout" }), "timeout");
  await collect((p) => p.http.fault("revalidate", { kind: "replace", status: 403, bodyText: JSON.stringify({ ok: false, status: "rejected", reason: "x" }) }), "unknown_rejection");

  const parts = createVerifierHarness();
  const result = await claimOf(parts, parts.issuer.issue());
  assert.deepEqual(Object.keys(result).sort(), ["actionId", "authorizationId", "claimReference", "status"]);
  const forbidden = /address|street|postcode|postal|zip|email|phone|surname|firstname|lastname|"name"/i;
  for (const call of parts.http.calls) {
    assert.ok(!forbidden.test(call.bodyText));
    assert.ok(!forbidden.test(Object.keys(call.headers).join()));
  }
  assert.ok(!forbidden.test(JSON.stringify(baseTerms())));
});

add("bindings.no-accepted-binding-is-forged-and-sandbox-gates-are-untouched", async () => {
  const sandbox = createRuntimeHarness({ runtimeOptions: { mode: "sandbox", sandboxEnabled: true } });
  await assert.rejects(sandbox.runtime.submit(envelope(submitCommand(sandbox.issuer.issue())), scope), (error) => {
    assert.ok(error instanceof ConnectorError);
    assert.equal(error.code, "sandbox_disabled");
    return true;
  });
  assert.equal(sandbox.http.calls.length, 0);
  const missing = createRuntimeHarness({ bindingOverrides: { order_authorization: { state: "missing", schemaVersion: undefined, sourceRevision: undefined, fixtureDigest: undefined } } });
  await expectConnectorError(missing.runtime.submit(envelope(submitCommand(missing.issuer.issue())), scope), "contract_missing", "not_dispatched");
  assert.equal(missing.http.calls.length, 0);

  const source = readFileSync(new URL("../src/order-authorization-client.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/state:\s*["']accepted["']/.test(code));
  assert.ok(!/sourceRevision/.test(code));
  assert.ok(!/\bfetch\s*\(|process\.env|https?:\/\/|XMLHttpRequest|node:https?|node:net|readFile|dotenv/.test(code));
  assert.ok(!/["'`]prodigi["'`]/i.test(code));
  const contracts = readFileSync(new URL("../src/contracts.ts", import.meta.url), "utf8");
  assert.ok(!/accepted/.test(contracts.replace(/\/\*[\s\S]*?\*\//g, "")));
});

add("provenance.vendored-fixture-hashes-equal-provenance-and-pins", () => {
  assert.equal(provenance.appCommit, "7d2dd17810425f0b06e07dadbba3e173800ea5fd");
  assert.equal(provenance.appTree, "b20931363cb86e60bdb87f650ed2b444d30ca8ea");
  assert.deepEqual(readdirSync(FIXTURE_DIR).sort(), [...provenance.files.map((file) => file.path), "provenance.json"].sort());
  for (const file of provenance.files) {
    const bytes = readFileSync(`${FIXTURE_DIR}/${file.path}`);
    assert.equal(bytes.length, file.byteLength, file.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.path);
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), file.gitBlobSha1, file.path);
    assert.equal(file.source, `fixtures/order-authorization/${file.path}`);
  }
  assert.equal(readFixtureJson("fixture-key.json").kid, "fixture");
  assert.ok(readFixtureText("README.md").startsWith("# Order authorization fixtures"));
  assert.ok(provenance.description.includes("NEVER PRODUCTION"));
});

// ---- runner self-checks -----------------------------------------------------------------------------------------

add("runner.output-parser-rejects-malformed-and-inconsistent-reports", () => {
  const good = {
    schemaVersion: "fulfillment-order-authorization-case-results/1", suite: "order-authorization",
    caseCount: ORDER_AUTHORIZATION_SUITE_CASE_IDS.length, passed: ORDER_AUTHORIZATION_SUITE_CASE_IDS.length, failed: 0, skipped: 0,
    cases: ORDER_AUTHORIZATION_SUITE_CASE_IDS.map((id) => ({ id, status: "passed" }))
  };
  assert.equal(parseOrderAuthorizationOutput(`${JSON.stringify(good)}\n`).valid, true);
  for (const bad of ["", "{}", `${JSON.stringify(good)}`, `${JSON.stringify(good)}\r\n`, `${JSON.stringify({ ...good, skipped: 1 })}\n`,
    `${JSON.stringify({ ...good, cases: good.cases.slice(1) })}\n`, `${JSON.stringify({ ...good, cases: [...good.cases].reverse() })}\n`,
    `${JSON.stringify({ ...good, extra: true })}\n`, `${JSON.stringify({ ...good, passed: good.passed - 1, failed: 1 })}\n`]) {
    assert.equal(parseOrderAuthorizationOutput(bad).valid, false);
  }
});

add("runner.report-validator-and-process-control-reject-unsafe-reports", () => {
  const spawned = runOrderAuthorizationTests({ spawn: () => ({ stdout: "", stderr: "boom", status: 1, signal: null }) });
  assert.equal(spawned.status, "failed");
  assert.equal(validOrderAuthorizationRunnerReport(spawned), true);
  const missing = runOrderAuthorizationTests({ spawn: () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); } });
  assert.equal(missing.status, "failed");
  assert.equal(validOrderAuthorizationRunnerReport(missing), true);
  assert.equal(validOrderAuthorizationRunnerReport({ ...spawned, injected: "field" }), false);
  assert.equal(validOrderAuthorizationRunnerReport({ ...spawned, orderCalls: 1 }), false);
  assert.equal(validOrderAuthorizationRunnerReport({ ...spawned, sandboxReady: true }), false);
  assert.equal(validOrderAuthorizationRunnerReport({ ...spawned, status: "passed" }), false);
});

assert.deepEqual(cases.map((testCase) => testCase.id), [...ORDER_AUTHORIZATION_SUITE_CASE_IDS], "case ids must match the runner list in order");

const caseRecords = [];
for (const testCase of cases) {
  try {
    await testCase.run();
    caseRecords.push({ id: testCase.id, status: "passed" });
  } catch (error) {
    const detail = error instanceof assert.AssertionError ? "assertion_failed" : "case_execution_failed";
    caseRecords.push({ id: testCase.id, status: "failed", detail });
    if (process.env.FC_ORDER_AUTH_DEBUG === "1") process.stderr.write(`${testCase.id}: ${error?.stack ?? error}\n`);
  }
}

const passed = caseRecords.filter((record) => record.status === "passed").length;
const failed = caseRecords.length - passed;
process.stdout.write(`${JSON.stringify({
  schemaVersion: "fulfillment-order-authorization-case-results/1",
  suite: "order-authorization",
  caseCount: cases.length,
  passed,
  failed,
  skipped: 0,
  cases: caseRecords
})}\n`);
if (failed !== 0) process.exitCode = 1;
