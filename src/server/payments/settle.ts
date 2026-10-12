import "server-only";
import type { OrderPayment } from "@/customer/pages/commerce";
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
   * count (for example the total, and the total less tax a merchant of record added on top).
   */
  charged: { currency: string; amountsMinor: number[] };
}

export type Settled = { handled: false } | { handled: true; status: OrderPayment["status"] };

/**
 * Applies a provider payment to its order. Deliveries repeat and arrive out of order, so a payment only moves forward:
 * a paid order is never downgraded, a mismatched charge never marks one paid, and the receipt is sent once, on the
 * transition to paid, which happens inside one storage transaction.
 */
export async function settlePayment(p: ProviderPayment, origin: string): Promise<Settled> {
  let mismatch = false;
  const result = await getStorage().updateOrderPayment(p.orderId, (order) => {
    const cur = order.payment;
    if (!cur || cur.provider !== p.provider || cur.status === "paid") return null;
    if (p.sessionId && p.sessionId !== cur.checkoutSessionId) return null;
    const matches = p.charged.currency.toUpperCase() === cur.currency && p.charged.amountsMinor.includes(cur.amountMinor);
    if (p.status === "paid" && !matches) {
      mismatch = true;
      return null;
    }
    if (p.status === cur.status && (p.paymentId ?? undefined) === cur.paymentId) return null;
    return { ...cur, status: p.status, ...(p.paymentId ? { paymentId: p.paymentId } : {}), updatedAt: new Date().toISOString() };
  });
  if (mismatch) console.error(`[payments] ${p.provider} amount or currency mismatch for an order; left unpaid`);
  // Unknown order, or nothing to change (a repeat, an older event, a refused charge).
  if (!result || result.after === result.before) return { handled: false };

  if (result.before.payment?.status !== "paid" && result.after.payment?.status === "paid") {
    const row = await getStorage().getOrder(p.orderId);
    const email = row?.email ?? result.after.email;
    if (email) await sendReceipt(result.after, row?.accountId ?? null, email, origin);
  }
  return { handled: true, status: result.after.payment?.status ?? p.status };
}
