import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      for (const ext of [".ts", ".tsx"]) {
        const file = fileURLToPath(new URL(`../src/${specifier.slice(2)}${ext}`, import.meta.url));
        if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
      }
    }
    if (specifier.startsWith(".") && context.parentURL) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});

const dir = mkdtempSync(join(tmpdir(), "ticketstub-payments-test-"));
const key = `whsec_${randomBytes(24).toString("base64")}`;
Object.assign(process.env, {
  TICKETSTUB_DB: join(dir, "ticketstub.sqlite"),
  TICKETSTUB_FILES: join(dir, "files"),
  APP_URL: "https://getticketstub.test",
  DODO_PAYMENTS_API_KEY: "test-key",
  DODO_PAYMENTS_WEBHOOK_KEY: key,
  DODO_PAYMENTS_PRODUCT_ID: "pdt_test",
  DODO_PAYMENTS_ENVIRONMENT: "test_mode",
});
delete process.env.RESEND_API_KEY;

const { verifiedTotalMinor, isDigitalOnly, allOrderable } = await import("../src/server/payments/pricing.ts");
const { dodoConfig, verifyWebhook } = await import("../src/server/payments/dodo.ts");
const { getStorage } = await import("../src/server/index.ts");
const { POST } = await import("../src/app/api/payments/dodo/webhook/route.ts");

const line = (material, finish, totalMinor) => ({ title: "Show", material, finish, size: material === "digital" ? "file" : "classic", totalMinor });

test("verifies a paid order's amounts against the price list", () => {
  assert.equal(verifiedTotalMinor({ lines: [line("digital", "matte", 900)], totalMinor: 900 }), 900);
  // seats multiply the unit price; a digital finish adds nothing
  assert.equal(verifiedTotalMinor({ lines: [line("digital", "foil", 1800)], totalMinor: 1800 }), 1800);
  // print 4900 + foil 600, plus flat shipping 600
  assert.equal(verifiedTotalMinor({ lines: [line("print", "foil", 5500)], totalMinor: 6100 }), 6100);
  for (const bad of [
    { lines: [line("digital", "matte", 100)], totalMinor: 100 }, // under the unit price
    { lines: [line("digital", "matte", 1000)], totalMinor: 1000 }, // not a whole number of stubs
    { lines: [line("digital", "matte", 900)], totalMinor: 1 }, // total disagrees with the lines
    { lines: [line("print", "matte", 4900)], totalMinor: 4900 }, // shipping missing
    { lines: [line("digital", "matte", 900 * 201)], totalMinor: 900 * 201 }, // over the quantity cap
  ]) assert.throws(() => verifiedTotalMinor(bad), (e) => e.code === "amount_mismatch");
  assert.equal(isDigitalOnly({ lines: [line("digital", "matte", 900)] }), true);
  assert.equal(isDigitalOnly({ lines: [line("digital", "matte", 900), line("card", "matte", 2900)] }), false);
  assert.equal(isDigitalOnly({ lines: [] }), false);
  assert.equal(allOrderable({ lines: [{ ...line("digital", "matte", 900), variantStatus: "orderable" }] }), true);
  assert.equal(allOrderable({ lines: [{ ...line("digital", "holo", 900), variantStatus: "preview" }] }), false, "holo is a preview");
  assert.equal(allOrderable({ lines: [line("digital", "matte", 900)] }), false, "an unknown status is not orderable");
});

test("turns payments off unless every setting and an explicit environment are present", () => {
  const full = { DODO_PAYMENTS_API_KEY: "k", DODO_PAYMENTS_WEBHOOK_KEY: "w", DODO_PAYMENTS_PRODUCT_ID: "p", DODO_PAYMENTS_ENVIRONMENT: "test_mode" };
  assert.equal(dodoConfig(full)?.baseUrl, "https://test.dodopayments.com");
  assert.equal(dodoConfig({ ...full, DODO_PAYMENTS_ENVIRONMENT: "live_mode" })?.baseUrl, "https://live.dodopayments.com");
  assert.equal(dodoConfig({ ...full, DODO_PAYMENTS_ENVIRONMENT: undefined }), null);
  assert.equal(dodoConfig({ ...full, DODO_PAYMENTS_ENVIRONMENT: "live" }), null);
  for (const k of ["DODO_PAYMENTS_API_KEY", "DODO_PAYMENTS_WEBHOOK_KEY", "DODO_PAYMENTS_PRODUCT_ID"]) assert.equal(dodoConfig({ ...full, [k]: "" }), null);
});

function sign(body, { id = `msg_${randomBytes(6).toString("hex")}`, at = Math.floor(Date.now() / 1000), secret = key } = {}) {
  const raw = Buffer.from(secret.slice("whsec_".length), "base64");
  const sig = createHmac("sha256", raw).update(`${id}.${at}.${body}`).digest("base64");
  return new Headers({ "webhook-id": id, "webhook-timestamp": String(at), "webhook-signature": `v1,${sig}`, "content-type": "application/json" });
}

test("accepts only a current, correctly signed webhook", () => {
  const body = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_1" } });
  assert.ok(verifyWebhook(key, sign(body), body));
  assert.equal(verifyWebhook(key, sign(body), `${body} `), null, "a changed body fails");
  assert.equal(verifyWebhook(key, sign(body, { at: Math.floor(Date.now() / 1000) - 600 }), body), null, "an old timestamp fails");
  assert.equal(verifyWebhook(key, sign(body, { secret: `whsec_${randomBytes(24).toString("base64")}` }), body), null, "another key fails");
  const h = sign(body);
  h.set("webhook-signature", `v1,AAAA ${h.get("webhook-signature")}`);
  assert.ok(verifyWebhook(key, h, body), "any one matching v1 signature is enough");
  h.delete("webhook-id");
  assert.equal(verifyWebhook(key, h, body), null);
});

// The Dodo API as the webhook route sees it: GET /payments/:id answers with whatever the test sets.
let remote = {};
globalThis.fetch = async (url) => {
  const id = decodeURIComponent(String(url).split("/payments/")[1] ?? "");
  const p = remote[id];
  return p ? new Response(JSON.stringify(p), { status: 200 }) : new Response("{}", { status: 404 });
};

async function placePending(id, amountMinor = 900) {
  await getStorage().createOrder({
    id, mode: "sandbox", createdAt: new Date().toISOString(), stubIds: ["stub_1"], lines: [line("digital", "matte", amountMinor)],
    totalMinor: amountMinor, currency: "USD", method: "card", email: "buyer@example.test",
    payment: { provider: "dodo", environment: "test_mode", status: "pending", amountMinor, currency: "USD", checkoutSessionId: `cks_${id}`, updatedAt: new Date().toISOString() },
  }, null, "buyer@example.test");
}

async function deliver(type, paymentId, headers) {
  const body = JSON.stringify({ business_id: "bus_1", type, timestamp: new Date().toISOString(), data: { payment_id: paymentId } });
  const res = await POST(new Request("https://getticketstub.test/api/payments/dodo/webhook", { method: "POST", headers: headers ?? sign(body), body }));
  return { status: res.status, json: await res.json() };
}

const statusOf = async (id) => (await getStorage().getOrder(id))?.order.payment?.status;

test("marks an order paid only from the payment fetched back from Dodo, once, and never downgrades it", async () => {
  await placePending("ord_a");
  remote.pay_a = { payment_id: "pay_a", status: "succeeded", total_amount: 900, tax: 0, currency: "USD", checkout_session_id: "cks_ord_a", metadata: { order_id: "ord_a" } };
  let r = await deliver("payment.succeeded", "pay_a");
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.handled, r.json.status], [true, "paid"]);
  assert.equal(await statusOf("ord_a"), "paid");
  // a repeated delivery changes nothing
  r = await deliver("payment.succeeded", "pay_a");
  assert.equal(r.json.handled, false);
  // an out-of-order failure after success leaves it paid
  remote.pay_a = { ...remote.pay_a, status: "failed" };
  r = await deliver("payment.failed", "pay_a");
  assert.equal(r.json.handled, false);
  assert.equal(await statusOf("ord_a"), "paid");
});

test("ignores the webhook body's claims and another checkout session's payment", async () => {
  await placePending("ord_b", 1800);
  // another checkout session for the same order id is not this order's payment
  remote.pay_b = { payment_id: "pay_b", status: "succeeded", total_amount: 1800, currency: "USD", checkout_session_id: "cks_other", metadata: { order_id: "ord_b" } };
  assert.equal((await deliver("payment.succeeded", "pay_b")).json.handled, false);
  assert.equal(await statusOf("ord_b"), "pending");
  // tax added on top of the asked amount is accepted
  remote.pay_b = { ...remote.pay_b, total_amount: 1950, tax: 150, checkout_session_id: "cks_ord_b" };
  assert.equal((await deliver("payment.succeeded", "pay_b")).json.status, "paid");
});

test("records a failure, refuses bad signatures and acknowledges unrelated events", async () => {
  await placePending("ord_c");
  remote.pay_c = { payment_id: "pay_c", status: "failed", total_amount: 900, currency: "USD", checkout_session_id: "cks_ord_c", metadata: { order_id: "ord_c" } };
  assert.equal((await deliver("payment.failed", "pay_c")).json.status, "failed");
  const body = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_c" } });
  assert.equal((await deliver("payment.succeeded", "pay_c", sign(`${body}x`))).status, 401);
  assert.deepEqual((await deliver("refund.succeeded", "pay_c")).json, { ok: true, handled: false });
  // a payment Dodo doesn't know makes Dodo retry later
  assert.equal((await deliver("payment.succeeded", "pay_missing")).status, 502);
});

const eventsOf = async (type) => (await getStorage().listEvents({ limit: 200 })).filter((e) => e.type === type);

test("holds a charge that isn't the asked amount or currency for review, with an event and an order ref, and never overwrites it", async () => {
  const { refOf } = await import("../src/server/events.ts");
  await placePending("ord_m", 1800);
  // the API says the charge was smaller than the order: a real charge, so it is not left pending
  remote.pay_m = { payment_id: "pay_m", status: "succeeded", total_amount: 100, currency: "USD", checkout_session_id: "cks_ord_m", metadata: { order_id: "ord_m" } };
  const r = await deliver("payment.succeeded", "pay_m");
  assert.deepEqual([r.status, r.json.status], [200, "needs_review"]);
  assert.equal(await statusOf("ord_m"), "needs_review");
  const [ev] = (await eventsOf("payment_needs_review")).filter((e) => e.fields.order === refOf("ord_m"));
  assert.deepEqual([ev.fields.provider, ev.fields.reason], ["dodo", "amount"]);
  // a later, correct-looking delivery cannot talk it into paid
  remote.pay_m = { ...remote.pay_m, total_amount: 1800 };
  assert.equal((await deliver("payment.succeeded", "pay_m")).json.handled, false);
  assert.equal(await statusOf("ord_m"), "needs_review");
  // a wrong currency is held too
  await placePending("ord_n");
  remote.pay_n = { payment_id: "pay_n", status: "succeeded", total_amount: 900, currency: "EUR", checkout_session_id: "cks_ord_n", metadata: { order_id: "ord_n" } };
  assert.equal((await deliver("payment.succeeded", "pay_n")).json.status, "needs_review");
  assert.ok((await eventsOf("payment_needs_review")).some((e) => e.fields.reason === "currency"));
});

test("records order_paid once, on the transition to paid, with what was charged", async () => {
  const { refOf } = await import("../src/server/events.ts");
  await placePending("ord_p");
  remote.pay_p = { payment_id: "pay_p", status: "succeeded", total_amount: 1050, tax: 150, currency: "USD", checkout_session_id: "cks_ord_p", metadata: { order_id: "ord_p" } };
  await deliver("payment.succeeded", "pay_p");
  await deliver("payment.succeeded", "pay_p");
  const paid = (await eventsOf("order_paid")).filter((e) => e.fields.order === refOf("ord_p"));
  assert.equal(paid.length, 1);
  assert.deepEqual([paid[0].fields.totalMinor, paid[0].fields.provider], [1050, "dodo"]);
  assert.equal((await getStorage().getOrder("ord_p")).order.payment.chargedMinor, 1050);
});

test("the receipt prints what was charged, tax included", async () => {
  const { receiptMail } = await import("../src/server/templates.ts");
  const order = { id: "ord_r", mode: "sandbox", createdAt: "x", stubIds: [], lines: [line("digital", "matte", 900)], totalMinor: 900, currency: "USD", method: "card",
    payment: { provider: "dodo", environment: "test_mode", status: "paid", amountMinor: 900, chargedMinor: 1050, currency: "USD", checkoutSessionId: "c", updatedAt: "x" } };
  const mail = receiptMail(order, "https://getticketstub.test/wall", "");
  assert.match(mail.text, /Tax: \$1\.5\n/);
  assert.match(mail.text, /Total: \$10\.5\n/);
  assert.match(receiptMail({ ...order, payment: undefined }, "https://getticketstub.test/wall", "").text, /Total: \$9\n/);
});

test("caps the webhook body while it streams, before anything is parsed", async () => {
  const big = "x".repeat(300 * 1024);
  // no content-length (a chunked body), so only the streaming cap can refuse it
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
  const req = new Request("https://getticketstub.test/api/payments/dodo/webhook", { method: "POST", headers: sign(big), body: stream, duplex: "half" });
  const res = await POST(req);
  assert.equal(res.status, 413);
});

test("accepts APP_URL only as an absolute https URL, or http on localhost", async () => {
  const { configuredOrigin } = await import("../src/server/http.ts");
  const was = process.env.APP_URL;
  try {
    for (const [v, want] of [["https://getticketstub.com/x", "https://getticketstub.com"], ["http://localhost:3000", "http://localhost:3000"], ["http://getticketstub.com", null], ["getticketstub.com", null], ["javascript:alert(1)", null], ["", null]]) {
      process.env.APP_URL = v;
      assert.equal(configuredOrigin(), want, v);
    }
  } finally {
    process.env.APP_URL = was;
  }
});
