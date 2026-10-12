import type { Metadata } from "next";
import PartsBoard from "./PartsBoard";

export const metadata: Metadata = { title: "Desk parts · TicketStub" };

export default function PartsPage() {
  return <PartsBoard />;
}
