import type { Metadata } from "next";
import AccountClient from "./AccountClient";

export const metadata: Metadata = { title: "Your account · TicketStub", robots: { index: false, follow: false } };

export default function AccountPage() {
  return <AccountClient />;
}
