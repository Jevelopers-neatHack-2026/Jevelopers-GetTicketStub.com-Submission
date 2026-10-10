"use client";
// Placing a sandbox order: the local record always lands first (it is the offline copy), then the server
// is told so it can keep the order and email the receipt. A failed request never undoes the order.
import { addOrder, type Order } from "@/customer/pages/commerce";
import { api } from "./api";

export interface Placed {
  order: Order;
  /** True when the server took the order, so the receipt is on its way to order.email. */
  receipt: boolean;
}

export async function placeOrder(draft: Omit<Order, "id" | "mode" | "createdAt">): Promise<Placed> {
  const local = addOrder(draft);
  // Signed out with no email there is nobody to send a receipt to: the order stays on this device.
  try {
    const { order } = await api.order(draft);
    return { order, receipt: !!draft.email };
  } catch {
    return { order: local, receipt: false };
  }
}
