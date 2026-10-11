"use client";
// Placing a sandbox order: the local record always lands first (it is the offline copy), then the server
// is told so it can keep the order and email the receipt. A failed request never undoes the order.
import { addOrder, type Order } from "@/customer/pages/commerce";
import { codeOf } from "@/customer/feedback-messages/messages";
import { api } from "./api";
import { isSavingOff } from "./saving";

export interface Placed {
  order: Order;
  /** True when the server took the order, so the receipt is on its way to order.email. */
  receipt: boolean;
  /** Set when the server refused or couldn't be reached: the order is only on this device. Catalog code, never shown raw. */
  code?: string;
}

export async function placeOrder(draft: Omit<Order, "id" | "mode" | "createdAt">): Promise<Placed> {
  const local = addOrder(draft);
  // Signed out with no email there is nobody to send a receipt to, and with saving off nobody to keep it: the order stays on this device.
  if (isSavingOff()) return { order: local, receipt: false };
  try {
    const { order } = await api.order(draft);
    return { order, receipt: !!draft.email };
  } catch (e) {
    return { order: local, receipt: false, code: codeOf(e) };
  }
}

/** Sends an order that stayed on this device to the server again. It does not make a second local record. */
export async function resendOrder(placed: Placed): Promise<Placed> {
  if (isSavingOff()) return placed;
  const { order } = placed;
  try {
    const sent = await api.order({ stubIds: order.stubIds, lines: order.lines, capabilityVersion: order.capabilityVersion, totalMinor: order.totalMinor, currency: order.currency, quoteId: order.quoteId, method: order.method, email: order.email });
    return { order: sent.order, receipt: !!order.email };
  } catch (e) {
    return { order, receipt: false, code: codeOf(e) };
  }
}
