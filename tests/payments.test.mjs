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
const stripeSecret = `whsec_${randomBytes(16).toString("hex")}`;
Object.assign(process.env, {
  TICKETSTUB_DB: join(dir, "ticketstub.sqlite"),
  TICKETSTUB_FILES: join(dir, "files"),
  APP_URL: "https://getticketstub.test",
  DODO_PAYMENTS_API_KEY: "test-key",
  DODO_PAYMENTS_WEBHOOK_KEY: key,
  DODO_PAYMENTS_PRODUCT_ID: "pdt_test",
  DODO_PAYMENTS_ENVIRONMENT: "test_mode",
  STRIPE_SECRET_KEY: "sk_test_fixture",
  STRIPE_WEBHOOK_SECRET: stripeSecret,
});
delete process.env.RESEND_API_KEY;

const { verifiedTotalMinor, isDigitalOnly, allOrderable } = await import("../src/server/payments/pricing.ts");
const { dodoConfig, verifyWebhook } = await import("../src/server/payments/dodo.ts");
const { getStorage } = await import("../src/server/index.ts");
const { POST } = await import("../src/app/api/payments/dodo/webhook/route.ts");
const stripe = await import("../src/server/payments/stripe.ts");
const { POST: STRIPE_POST } = await import("../src/app/api/payments/stripe/webhook/route.ts");

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
  const u = String(url);
  const id = decodeURIComponent((u.includes("/checkout/sessions/") ? u.split("/checkout/sessions/")[1] : u.split("/payments/")[1]) ?? "");
  const p = remote[id];
  return p ? new Response(JSON.stringify(p), { status: 200 }) : new Response("{}", { status: 404 });
};

async function placePending(id, amountMinor = 900, provider = "dodo") {
  await getStorage().createOrder({
    id, mode: "sandbox", createdAt: new Date().toISOString(), stubIds: ["stub_1"], lines: [line("digital", "matte", amountMinor)],
    totalMinor: amountMinor, currency: "USD", method: "card", email: "buyer@example.test",
    payment: { provider, environment: "test_mode", status: "pending", amountMinor, currency: "USD", checkoutSessionId: provider === "stripe" ? `cs_test_${id}` : `cks_${id}`, updatedAt: new Date().toISOString() },
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

test("ignores the webhook body's claims and refuses a mismatched charge", async () => {
  await placePending("ord_b", 1800);
  // the API says the charge was smaller than the order: it stays unpaid
  remote.pay_b = { payment_id: "pay_b", status: "succeeded", total_amount: 100, currency: "USD", checkout_session_id: "cks_ord_b", metadata: { order_id: "ord_b" } };
  assert.equal((await deliver("payment.succeeded", "pay_b")).json.handled, false);
  assert.equal(await statusOf("ord_b"), "pending");
  // another checkout session for the same order id is not this order's payment
  remote.pay_b = { ...remote.pay_b, total_amount: 1800, checkout_session_id: "cks_other" };
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

test("reads Stripe test or live mode from the secret key and refuses anything else", () => {
  const w = "whsec_x";
  assert.equal(stripe.stripeConfig({ STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: w })?.environment, "test_mode");
  assert.equal(stripe.stripeConfig({ STRIPE_SECRET_KEY: "rk_live_1", STRIPE_WEBHOOK_SECRET: w })?.environment, "live_mode");
  assert.equal(stripe.stripeConfig({ STRIPE_SECRET_KEY: "pk_test_1", STRIPE_WEBHOOK_SECRET: w }), null, "a publishable key can't charge");
  assert.equal(stripe.stripeConfig({ STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "" }), null);
  assert.equal(stripe.stripeConfig({ STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "nope" }), null);
});

function stripeSign(body, { at = Math.floor(Date.now() / 1000), secret = stripeSecret } = {}) {
  return `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${body}`).digest("hex")}`;
}

test("accepts only a current, correctly signed Stripe webhook", () => {
  const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
  assert.equal(stripe.verifyWebhook(stripeSecret, stripeSign(body), body), true);
  assert.equal(stripe.verifyWebhook(stripeSecret, stripeSign(body), `${body} `), false);
  assert.equal(stripe.verifyWebhook(stripeSecret, stripeSign(body, { at: Math.floor(Date.now() / 1000) - 600 }), body), false);
  assert.equal(stripe.verifyWebhook(stripeSecret, stripeSign(body, { secret: "whsec_other" }), body), false);
  assert.equal(stripe.verifyWebhook(stripeSecret, `${stripeSign(body)},v1=${"0".repeat(64)}`, body), true, "any one matching v1 is enough");
  assert.equal(stripe.verifyWebhook(stripeSecret, null, body), false);
});

async function deliverStripe(type, sessionId, signature) {
  const body = JSON.stringify({ id: `evt_${randomBytes(4).toString("hex")}`, type, data: { object: { id: sessionId, payment_status: "paid", amount_total: 1 } } });
  const res = await STRIPE_POST(new Request("https://getticketstub.test/api/payments/stripe/webhook", { method: "POST", headers: { "stripe-signature": signature ?? stripeSign(body) }, body }));
  return { status: res.status, json: await res.json() };
}

test("settles a Stripe order from the session fetched back, forward-only", async () => {
  await placePending("ord_s1", 6100, "stripe");
  const session = { id: "cs_test_ord_s1", status: "complete", payment_status: "paid", amount_total: 6100, currency: "usd", metadata: { order_id: "ord_s1" }, payment_intent: "pi_1" };
  remote.cs_test_ord_s1 = session;
  let r = await deliverStripe("checkout.session.completed", "cs_test_ord_s1");
  assert.deepEqual([r.status, r.json.handled, r.json.status], [200, true, "paid"]);
  assert.equal((await getStorage().getOrder("ord_s1"))?.order.payment?.paymentId, "pi_1");
  r = await deliverStripe("checkout.session.completed", "cs_test_ord_s1");
  assert.equal(r.json.handled, false, "a repeat changes nothing");
  remote.cs_test_ord_s1 = { ...session, status: "expired", payment_status: "unpaid" };
  assert.equal((await deliverStripe("checkout.session.expired", "cs_test_ord_s1")).json.handled, false, "paid is never downgraded");
  assert.equal(await statusOf("ord_s1"), "paid");
});

test("trusts the fetched Stripe session, not the event body, and maps expiry and async failure", async () => {
  await placePending("ord_s2", 6100, "stripe");
  // the event body claims paid with amount 1; the API says unpaid: stays pending
  remote.cs_test_ord_s2 = { id: "cs_test_ord_s2", status: "complete", payment_status: "unpaid", amount_total: 6100, currency: "usd", metadata: { order_id: "ord_s2" } };
  assert.equal((await deliverStripe("checkout.session.completed", "cs_test_ord_s2")).json.handled, false);
  assert.equal(await statusOf("ord_s2"), "pending");
  // paid but for a different amount: refused
  remote.cs_test_ord_s2 = { ...remote.cs_test_ord_s2, payment_status: "paid", amount_total: 100 };
  assert.equal((await deliverStripe("checkout.session.async_payment_succeeded", "cs_test_ord_s2")).json.handled, false);
  assert.equal(await statusOf("ord_s2"), "pending");
  // a bank debit that finally failed
  remote.cs_test_ord_s2 = { ...remote.cs_test_ord_s2, payment_status: "unpaid", amount_total: 6100 };
  assert.equal((await deliverStripe("checkout.session.async_payment_failed", "cs_test_ord_s2")).json.status, "failed");
  await placePending("ord_s3", 6100, "stripe");
  remote.cs_test_ord_s3 = { id: "cs_test_ord_s3", status: "expired", payment_status: "unpaid", amount_total: 6100, currency: "usd", client_reference_id: "ord_s3" };
  assert.equal((await deliverStripe("checkout.session.expired", "cs_test_ord_s3")).json.status, "cancelled");
  // a Dodo order is never settled by a Stripe event
  await placePending("ord_s4", 900, "dodo");
  remote.cs_test_ord_s4 = { id: "cks_ord_s4", status: "complete", payment_status: "paid", amount_total: 900, currency: "usd", metadata: { order_id: "ord_s4" } };
  assert.equal((await deliverStripe("checkout.session.completed", "cs_test_ord_s4")).json.handled, false);
  assert.equal(await statusOf("ord_s4"), "pending");
});

test("refuses bad Stripe signatures and acknowledges unrelated events", async () => {
  assert.equal((await deliverStripe("checkout.session.completed", "cs_x", "t=1,v1=00")).status, 401);
  assert.deepEqual((await deliverStripe("charge.refunded", "ch_1")).json, { ok: true, handled: false });
  assert.equal((await deliverStripe("checkout.session.completed", "cs_missing")).status, 502);
});
