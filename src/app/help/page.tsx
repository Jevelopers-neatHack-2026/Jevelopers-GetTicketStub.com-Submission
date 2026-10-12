import type { Metadata } from "next";
import HelpClient from "./HelpClient";

export const metadata: Metadata = { title: "Help · TicketStub", description: "How a stub is made, printed and kept: links, prices, your wall and organizer runs." };

export default function HelpPage() {
  return <HelpClient />;
}
