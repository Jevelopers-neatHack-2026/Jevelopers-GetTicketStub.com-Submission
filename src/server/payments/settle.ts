import "server-only";
import type { OrderPayment } from "@/customer/pages/commerce";
import { recordEvent } from "@/server/event-log";
import { refOf } from "@/server/events";
import { appOrigin } from "@/server/http";
import { getStorage } from "@/server/index";
import { sendReceipt } from "@/server/receipt";

/** What a provider's API (never a webhook body) says about an order's payment. */
export interface ProviderPayment {
  provider: OrderPayment["provider"];
  orderId: string;
  /** The checkout session the provider reports. Must be the one this order started. */
  sessionId: string | null;
  paymentId: string | null;
  status: OrderPayment["status"];
  /**
   * What the provider charged. It must equal the amount the server asked for: `amountsMinor` lists the readings that
   * count (for example the total, and the total less tax a merchant of record added on top). The first is the total
   * actually charged, which the receipt prints.
   */
  charged: { currency: string; amountsMinor: number[] };
}

export type Settled = { handled: false } | { handled: true; status: OrderPayment["status"] };

/**
 * Applies a provider payment to its order. Deliveries repeat and arrive out of order, so a payment only moves forward:
 * `pending` becomes `paid`, `failed`, `cancelled` or `needs_review`, and those four are final, so a late or repeated
 * delivery never overwrites them. A real charge that isn't the amount or currency the server asked for is held as
 * `needs_review` (never marked paid, never left pending) and recorded for staff. The receipt is sent once, on the
 * transition to paid, which happens inside one storage transaction.
 */
export async function settlePayment(p: ProviderPayment, req: Request): Promise<Settled> {
  let held: "amount" | "currency" | "late" | null = null;
  const result = await getStorage().updateOrderPayment(p.orderId, (order) => {
    const cur = order.payment;
    if (!cur || cur.provider !== p.provider || p.status === "pending") return null;
    if (p.sessionId && p.sessionId !== cur.checkoutSessionId) return null;
    if (cur.status !== "pending") {
      // The state stays as it is, but a real charge arriving after a failure (a card retried in the same checkout) is for staff.
      if (p.status === "paid" && (cur.status === "failed" || cur.status === "cancelled")) held = "late";
      return null;
    }
    const currencyOk = p.charged.currency.toUpperCase() === cur.currency;
    const next = { ...cur, ...(p.paymentId ? { paymentId: p.paymentId } : {}), updatedAt: new Date().toISOString() };
    if (p.status !== "paid") return { ...next, status: p.status };
    const chargedMinor = p.charged.amountsMinor[0];
    if (!currencyOk || !p.charged.amountsMinor.includes(cur.amountMinor)) {
      held = currencyOk ? "amount" : "currency";
      return { ...next, status: "needs_review", chargedMinor };
    }
    return { ...next, status: "paid", chargedMinor };
  });
  const orderRef = refOf(p.orderId);
  // Unknown order, or nothing to change (a repeat, an older event, a payment still pending).
  if (!result || result.after === result.before) {
    if (held) await flagForReview(p, orderRef, held, req);
    return { handled: false };
  }
  if (held) {
    await flagForReview(p, orderRef, held, req);
  } else if (result.after.payment?.status === "paid") {
    await recordEvent(req, "order_paid", { order: orderRef, totalMinor: result.after.payment.chargedMinor ?? result.after.payment.amountMinor, provider: p.provider });
    const row = await getStorage().getOrder(p.orderId);
    const email = row?.email ?? result.after.email;
    if (email) await sendReceipt(result.after, row?.accountId ?? null, email, appOrigin(req));
  }
  return { handled: true, status: result.after.payment?.status ?? p.status };
}

async function flagForReview(p: ProviderPayment, orderRef: string, reason: "amount" | "currency" | "late", req: Request): Promise<void> {
  console.error(`[payments] ${p.provider} charge needs review: ${reason}, order ${orderRef}`);
  await recordEvent(req, "payment_needs_review", { order: orderRef, provider: p.provider, reason });
}
