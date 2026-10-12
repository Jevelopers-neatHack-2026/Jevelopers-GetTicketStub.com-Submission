import type { OrderPayment } from "@/customer/pages/commerce";
import { HttpError, appOrigin, isObject, json, route } from "@/server/http";
import { getStorage, requireStorage } from "@/server/index";
import { DodoError, dodoConfig, getPayment, verifyWebhook, type DodoPayment } from "@/server/payments/dodo";
import { sendReceipt } from "@/server/receipt";

// Dodo Payments webhook. Only a signed delivery is read, and only the payment fetched back from Dodo's API is trusted:
// the body says which payment changed, never what it is. Deliveries repeat and arrive out of order, so the order's
// payment only moves forward, a paid order is never downgraded, and the receipt goes out on the one transition to paid.

const MAX_BODY = 256 * 1024;

function nextStatus(p: DodoPayment): OrderPayment["status"] {
  switch (p.status) {
    case "succeeded":
      return "paid";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}

/** The charge must be exactly the amount the server asked for, in USD (any tax Dodo adds is on top). */
const amountMatches = (p: DodoPayment, want: OrderPayment) => p.currency === want.currency && (p.total_amount === want.amountMinor || p.total_amount - (p.tax ?? 0) === want.amountMinor);

export const POST = route(async (req: Request) => {
  const dodo = dodoConfig();
  if (!dodo) throw new HttpError(503, "payments_off", "Payments are not configured.");
  requireStorage();
  const raw = await req.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, "too_large", "That webhook is too large.");
  if (!verifyWebhook(dodo.webhookKey, req.headers, raw)) throw new HttpError(401, "bad_signature", "The webhook signature is not valid.");

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "bad_request", "The webhook body is not JSON.");
  }
  const type = isObject(event) && typeof event.type === "string" ? event.type : "";
  const paymentId = isObject(event) && isObject(event.data) && typeof event.data.payment_id === "string" ? event.data.payment_id : "";
  // Signed but not about a payment (refunds, disputes, ...): acknowledged so Dodo stops retrying, and left alone.
  if (!type.startsWith("payment.") || !paymentId) return json({ ok: true, handled: false });

  let payment: DodoPayment;
  try {
    payment = await getPayment(dodo, paymentId);
  } catch (e) {
    if (!(e instanceof DodoError)) throw e;
    // A 5xx answer makes Dodo retry later.
    throw new HttpError(502, "provider_unavailable", "Dodo Payments could not be reached.");
  }
  const orderId = typeof payment.metadata?.order_id === "string" ? payment.metadata.order_id : "";
  if (!orderId) return json({ ok: true, handled: false });

  const status = nextStatus(payment);
  let mismatch = false;
  const result = await getStorage().updateOrderPayment(orderId, (order) => {
    const cur = order.payment;
    if (!cur || cur.provider !== "dodo" || cur.status === "paid") return null;
    if (payment.checkout_session_id && payment.checkout_session_id !== cur.checkoutSessionId) return null;
    if (status === "paid" && !amountMatches(payment, cur)) {
      mismatch = true;
      return null;
    }
    if (status === cur.status && cur.paymentId === payment.payment_id) return null;
    return { ...cur, status, paymentId: payment.payment_id, updatedAt: new Date().toISOString() };
  });
  if (mismatch) console.error(`[payments] dodo amount or currency mismatch for an order; left unpaid`);
  // Unknown order, or nothing to change (a repeat, an older event, a refused charge).
  if (!result || result.after === result.before) return json({ ok: true, handled: false });

  if (result.before.payment?.status !== "paid" && result.after.payment?.status === "paid") {
    const row = await getStorage().getOrder(orderId);
    const email = row?.email ?? result.after.email;
    if (email) await sendReceipt(result.after, row?.accountId ?? null, email, appOrigin(req));
  }
  return json({ ok: true, handled: true, status: result.after.payment?.status });
});
