import assert from "node:assert/strict";
import { test } from "node:test";
import { APPROVAL_SCHEMA, NOT_AUTHORIZED, bindStub, sha256Hex, signApproval } from "../src/server/approval-token.ts";
import {
  CONSUMER_SKEW_MS,
  ORDER_AUTH_AUDIENCE,
  ORDER_AUTH_FAILURES,
  ORDER_AUTH_NOT_AUTHORIZED,
  ORDER_AUTH_SCHEMA,
  actionIdOf,
  commandHash,
  consumerSignature,
  hashJson,
  orderAuthIdOf,
  signOrderAuthorization,
  termDiffs,
  verifyConsumerSignature,
  verifyOrderAuthorization,
} from "../src/server/order-auth-token.ts";
import { VARIANTS, authorizationGate, variantFor } from "../src/customer/pages/capabilities.ts";
import { verifyOrderAuthorization as referenceVerify } from "../fixtures/order-authorization/verify.mjs";

const KEY = "unit-test-key-not-a-secret-0000000000000000";
const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const h = (s) => sha256Hex(s);
const terms = () => ({
  orderRef: "ord_unit_0001",
  sku: null,
  options: { variantId: "print.classic.matte", material: "print", finish: "matte", size: "classic", quantity: 1 },
  quote: { id: "qt_unit_1", amountMinor: 5500, currency: "USD" },
  destination: { ref: "dst_unit_0001", digest: h("dest") },
  design: { versionId: "v1", designHash: h("d"), artHash: h("a"), factsHash: h("f"), compositionHash: h("c") },
  approvalId: "apr_unit_1",
  capabilityVersion: "2026-10-11.1",
});
const record = (over = {}, t = terms(), provider = "sandbox") => ({
  schema: ORDER_AUTH_SCHEMA, id: "oau_unit_1", issuer: "ticketstub", audience: ORDER_AUTH_AUDIENCE, tenant: { id: "t1" }, project: { kind: "stub", id: "s1" }, actor: { kind: "account", id: "t1" },
  action: "fulfillment.submit", provider, actionId: actionIdOf("t1", { kind: "stub", id: "s1" }, "fulfillment.submit", t.orderRef), command: { name: "submit_order", hash: commandHash("fulfillment.submit", provider, t) },
  terms: t, approval: { id: t.approvalId, purpose: "print.compose" }, idempotencyKey: "issue_unit_0001", membershipRevision: 2, notAuthorizes: ORDER_AUTH_NOT_AUTHORIZED,
  environment: "development", mode: "sandbox", issuedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 15 * 60_000).toISOString(), ...over,
});
const expect = (over = {}) => ({ tenant: "t1", project: { kind: "stub", id: "s1" }, action: "fulfillment.submit", provider: "sandbox", terms: terms(), ...over });
const live = { known: true, revoked: false, superseded: false, approval: "active", membershipRevision: 2, capabilityVersion: "2026-10-11.1", orderable: true, claim: null };
const token = signOrderAuthorization(record(), KEY);
const reason = (tok, e = expect(), state = live, intent = "verify", now = NOW + 60_000) => {
  const r = verifyOrderAuthorization(tok, KEY, e, now, state, intent);
  return r.ok ? "ok" : r.reason;
};

test("the action id is stable across renewals of one order and differs per order, tenant and project", () => {
  const p = { kind: "stub", id: "s1" };
  const a = actionIdOf("t1", p, "fulfillment.submit", "ord_1");
  assert.equal(a, actionIdOf("t1", p, "fulfillment.submit", "ord_1"));
  assert.notEqual(a, actionIdOf("t1", p, "fulfillment.submit", "ord_2"));
  assert.notEqual(a, actionIdOf("t2", p, "fulfillment.submit", "ord_1"));
  assert.notEqual(a, actionIdOf("t1", { kind: "stub", id: "s2" }, "fulfillment.submit", "ord_1"));
  assert.match(a, /^act_[a-f0-9]{32}$/);
  // a renewal with a new amount and destination keeps the action, but not the command
  const t2 = { ...terms(), quote: { id: "qt_unit_1", amountMinor: 6000, currency: "USD" }, destination: { ref: "dst_other_01", digest: h("other") } };
  assert.equal(actionIdOf("t1", p, "fulfillment.submit", t2.orderRef), actionIdOf("t1", p, "fulfillment.submit", terms().orderRef));
  assert.notEqual(commandHash("fulfillment.submit", "sandbox", t2), commandHash("fulfillment.submit", "sandbox", terms()));
});

test("the command hash covers the action, the provider and every term", () => {
  const base = commandHash("fulfillment.submit", "sandbox", terms());
  const changes = [
    (t) => (t.orderRef = "ord_other_01"), (t) => (t.sku = "SKU-1"), (t) => (t.options.quantity = 2), (t) => (t.options.size = "stamp"), (t) => (t.quote.amountMinor += 1),
    (t) => (t.quote.currency = "EUR"), (t) => (t.quote.id = "qt_x"), (t) => (t.destination.ref = "dst_x_0001"), (t) => (t.destination.digest = h("x")), (t) => (t.design.artHash = h("y")),
    (t) => (t.design.versionId = "v2"), (t) => (t.approvalId = "apr_x"), (t) => (t.capabilityVersion = "x"),
  ];
  for (const fn of changes) {
    const t = terms();
    fn(t);
    assert.notEqual(commandHash("fulfillment.submit", "sandbox", t), base);
  }
  assert.notEqual(commandHash("fulfillment.submit", "prodigi", terms()), base);
  assert.notEqual(commandHash("fulfillment.cancel", "sandbox", terms()), base);
  assert.equal(hashJson({ b: 1, a: 2 }), hashJson({ a: 2, b: 1 }));
});

test("term differences are named by path and never carry values", () => {
  const t = terms();
  t.quote.amountMinor = 1;
  t.design.artHash = h("secret-looking-value");
  const d = termDiffs(t, terms());
  assert.deepEqual(d.sort(), ["design.artHash", "quote.amountMinor"]);
  assert.ok(!JSON.stringify(d).includes("secret-looking-value"));
  assert.deepEqual(termDiffs(terms(), terms()), []);
  assert.deepEqual(termDiffs({ a: 1 }, { b: 1 }).sort(), ["a", "b"]);
});

test("the verifier checks in order: shape, forged, version, scope, terms, revoked, expired, approval, stale, gate, claim", () => {
  assert.equal(reason(token), "ok");
  assert.equal(reason("nope"), "unknown");
  assert.equal(reason(token.slice(0, -3) + "AAA"), "forged");
  assert.equal(reason(signOrderAuthorization(record(), "another-key-0000000000000000000000000")), "forged");
  assert.equal(reason(signOrderAuthorization(record({ schema: "ticketstub.order-authorization/2" }), KEY)), "unsupported_version");
  assert.equal(reason(signOrderAuthorization(record({ audience: "other" }), KEY)), "unknown");
  assert.equal(reason(token, expect({ tenant: "t2" })), "wrong_scope");
  assert.equal(reason(token, expect({ project: { kind: "stub", id: "s2" } })), "wrong_scope");
  assert.equal(reason(token, expect({ provider: "prodigi" })), "wrong_scope");
  assert.equal(reason(token, expect({ action: "fulfillment.cancel" })), "wrong_scope");
  const t = terms();
  t.quote.amountMinor = 5501;
  assert.equal(reason(token, expect({ terms: t })), "changed_terms");
  // scope beats terms; terms beat revoked; revoked beats expired; expired beats the approval; the approval beats stale; stale beats the gate
  assert.equal(reason(token, expect({ tenant: "t2", terms: t }), { ...live, revoked: true }), "wrong_scope");
  assert.equal(reason(token, expect({ terms: t }), { ...live, revoked: true }), "changed_terms");
  assert.equal(reason(token, expect(), { ...live, revoked: true }, "verify", NOW + 20 * 60_000), "revoked");
  assert.equal(reason(token, expect(), { ...live, approval: "revoked" }, "verify", NOW + 20 * 60_000), "expired");
  assert.equal(reason(token, expect(), { ...live, approval: "stale", superseded: true }), "stale_approval");
  assert.equal(reason(token, expect(), { ...live, superseded: true, orderable: false }), "stale");
  assert.equal(reason(token, expect(), { ...live, membershipRevision: 3 }), "stale");
  assert.equal(reason(token, expect(), { ...live, capabilityVersion: "next" }), "stale");
  assert.equal(reason(token, expect(), { ...live, orderable: false }), "not_orderable");
  assert.equal(reason(token, expect(), { ...live, known: false }), "unknown");
});

test("claims: verify refuses any claim, claim allows only the same key, revalidate needs the committed reference", () => {
  const mine = { ...live, claim: { reference: "clm_1", keyMatches: true } };
  const other = { ...live, claim: { reference: "clm_1", keyMatches: false } };
  assert.equal(reason(token, expect(), mine, "verify"), "already_claimed");
  assert.equal(reason(token, expect(), mine, "claim"), "ok");
  assert.equal(reason(token, expect(), other, "claim"), "already_claimed");
  assert.equal(reason(token, expect({ claimReference: "clm_1" }), mine, "revalidate"), "ok");
  assert.equal(reason(token, expect({ claimReference: "clm_2" }), mine, "revalidate"), "not_claimed");
  assert.equal(reason(token, expect({ claimReference: "clm_1" }), live, "revalidate"), "not_claimed");
  // authority lapses after the claim: every dispatch-time check still applies
  assert.equal(reason(token, expect({ claimReference: "clm_1" }), { ...mine, revoked: true }, "revalidate"), "revoked");
  assert.equal(reason(token, expect({ claimReference: "clm_1" }), { ...mine, approval: "revoked" }, "revalidate"), "stale_approval");
  assert.equal(reason(token, expect({ claimReference: "clm_1" }), mine, "revalidate", NOW + 16 * 60_000), "expired");
  assert.equal(reason(token, expect(), mine, "claim", NOW + 16 * 60_000), "expired");
});

test("the reference verifier in fixtures agrees with the server verifier on every state it can be put in", () => {
  const states = [live, { ...live, revoked: true }, { ...live, approval: "stale" }, { ...live, superseded: true }, { ...live, orderable: false }, { ...live, known: false }, { ...live, claim: { reference: "clm_1", keyMatches: true } }, { ...live, claim: { reference: "clm_1", keyMatches: false } }];
  const t = terms();
  t.options.quantity = 9;
  for (const state of states) {
    for (const intent of ["verify", "claim", "revalidate"]) {
      for (const [tok, e] of [[token, expect({ claimReference: "clm_1" })], [token, expect({ terms: t })], ["nope", expect()]]) {
        for (const at of [NOW + 60_000, NOW + 20 * 60_000]) {
          const a = verifyOrderAuthorization(tok, KEY, e, at, state, intent);
          const b = referenceVerify(tok, KEY, e, { now: at, state, intent });
          assert.equal(a.ok, b.ok);
          if (!a.ok) assert.deepEqual([a.reason, a.fields], [b.reason, b.fields]);
        }
      }
    }
  }
});

test("an approval token is never an authorization, and an authorization is never an approval", () => {
  const stub = {
    event: { title: "T" }, versions: [{ id: "v1", edition: "classic", art: { kind: "procedural", seed: 1 } }], currentVersionId: "v1",
    personal: { titleFont: 0, titleColor: "#000", foilTitle: false, hiddenFields: [] }, material: "print", finish: "matte",
  };
  const binding = bindStub(stub, "classic", { hash: h("art"), source: "ref" });
  const approval = signApproval(
    { schema: APPROVAL_SCHEMA, id: "apr_unit_1", issuer: "ticketstub", tenant: { id: "t1" }, project: { kind: "stub", id: "s1" }, purpose: "print.compose", actor: { kind: "account", id: "t1" }, binding, membershipRevision: 2, notAuthorizes: NOT_AUTHORIZED, environment: "development", mode: "sandbox", issuedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 3600_000).toISOString() },
    KEY,
  );
  assert.equal(reason(approval), "unknown"); // same key, same shape of token, different type: never accepted
  assert.equal(orderAuthIdOf(approval), null);
  assert.equal(orderAuthIdOf(token), "oau_unit_1");
  assert.ok(ORDER_AUTH_NOT_AUTHORIZED.includes("payment") && ORDER_AUTH_NOT_AUTHORIZED.includes("destination_change"));
});

test("every failure reason is reachable and listed", () => {
  const reached = new Set();
  const add = (r) => r !== "ok" && reached.add(r);
  add(reason("nope")); add(reason(token.slice(0, -3) + "AAA")); add(reason(signOrderAuthorization(record({ schema: "x/2" }), KEY))); add(reason(token, expect({ tenant: "t9" })));
  add(reason(token, expect({ terms: { ...terms(), sku: "S" } }))); add(reason(token, expect(), { ...live, revoked: true })); add(reason(token, expect(), live, "verify", NOW + 99 * 60_000));
  add(reason(token, expect(), { ...live, approval: "revoked" })); add(reason(token, expect(), { ...live, superseded: true })); add(reason(token, expect(), { ...live, orderable: false }));
  add(reason(token, expect(), { ...live, claim: { reference: "c", keyMatches: true } })); add(reason(token, expect({ claimReference: "c" }), live, "revalidate"));
  // idempotency_conflict is the issuer's: one key bound to two authorizations. It is not a property of one token.
  const issuerOnly = new Set(["idempotency_conflict"]);
  assert.deepEqual(ORDER_AUTH_FAILURES.filter((r) => !reached.has(r) && !issuerOnly.has(r)), []);
});

test("consumer request signing: method, path, body and time are all covered", () => {
  const key = "consumer-test-key-not-a-secret-00000000000";
  const body = JSON.stringify({ a: 1 });
  const ts = NOW;
  const sig = consumerSignature(key, ts, "POST", "/api/order-authorizations/claim", body);
  const ok = (over = {}) => verifyConsumerSignature(key, { timestamp: String(ts), signature: sig, ...over }, "POST", "/api/order-authorizations/claim", body, NOW + 1000);
  assert.equal(ok(), true);
  assert.equal(verifyConsumerSignature(key, { timestamp: String(ts), signature: sig }, "POST", "/api/order-authorizations/verify", body, NOW), false);
  assert.equal(verifyConsumerSignature(key, { timestamp: String(ts), signature: sig }, "GET", "/api/order-authorizations/claim", body, NOW), false);
  assert.equal(verifyConsumerSignature(key, { timestamp: String(ts), signature: sig }, "POST", "/api/order-authorizations/claim", `${body} `, NOW), false);
  assert.equal(verifyConsumerSignature("another-consumer-key-0000000000000000", { timestamp: String(ts), signature: sig }, "POST", "/api/order-authorizations/claim", body, NOW), false);
  assert.equal(verifyConsumerSignature(key, { timestamp: String(ts), signature: sig }, "POST", "/api/order-authorizations/claim", body, NOW + CONSUMER_SKEW_MS + 1), false);
  assert.equal(verifyConsumerSignature(key, { timestamp: String(ts), signature: sig }, "POST", "/api/order-authorizations/claim", body, NOW - CONSUMER_SKEW_MS - 1), false);
  assert.equal(ok({ timestamp: String(ts + 1) }), false);
  assert.equal(ok({ timestamp: null }), false);
  assert.equal(ok({ signature: null }), false);
  assert.equal(ok({ signature: "zz".repeat(32) }), false);
  assert.equal(ok({ signature: sig.slice(0, 62) }), false);
});

test("the authorization gate: preview never passes in live, unavailable never passes, sandbox only outside live, no SKU means no real provider", () => {
  const digitalMatte = variantFor("digital", "file", "matte");
  const printMatte = variantFor("print", "classic", "matte");
  const printHolo = variantFor("print", "classic", "holo");
  assert.equal(digitalMatte.status, "orderable");
  assert.equal(printMatte.status, "preview");
  assert.equal(printHolo.status, "unavailable");
  assert.deepEqual(authorizationGate(digitalMatte, "sandbox", "demo"), { ok: true, sku: null });
  assert.deepEqual(authorizationGate(printMatte, "sandbox", "demo"), { ok: true, sku: null }); // a sandbox fixture, never a real order
  assert.equal(authorizationGate(printMatte, "sandbox", "live").ok, false);
  assert.equal(authorizationGate(printHolo, "sandbox", "demo").ok, false);
  assert.equal(authorizationGate(undefined, "sandbox", "demo").ok, false);
  for (const v of VARIANTS) {
    for (const mode of ["demo", "live"]) assert.equal(authorizationGate(v, "prodigi", mode).ok, false, `${v.id} must not be authorizable for prodigi while no SKU is confirmed`);
    assert.equal(authorizationGate(v, "sandbox", "live").ok, false, `${v.id}: nothing is issuable in live mode yet`);
  }
  // once a variant is confirmed (a SKU, a supplier, status orderable), a live authorization for that supplier becomes possible, for that supplier only
  const confirmed = { ...digitalMatte, supplier: "Prodigi", sku: "GLOBAL-FOO-1", status: "orderable" };
  assert.deepEqual(authorizationGate(confirmed, "prodigi", "live"), { ok: true, sku: "GLOBAL-FOO-1" });
  assert.equal(authorizationGate(confirmed, "prodigi", "demo").ok, false);
  assert.equal(authorizationGate(confirmed, "sandbox", "live").ok, false);
  assert.equal(authorizationGate({ ...confirmed, supplier: "SomeoneElse" }, "prodigi", "live").ok, false);
});
