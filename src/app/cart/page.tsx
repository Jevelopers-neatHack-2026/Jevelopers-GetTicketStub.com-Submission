import type { Metadata } from "next";
import CartClient from "./CartClient";

export const metadata: Metadata = { title: "Your cart · TicketStub" };

export default function CartPage() {
  return <CartClient />;
}
