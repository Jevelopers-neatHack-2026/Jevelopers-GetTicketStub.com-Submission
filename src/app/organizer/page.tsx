import type { Metadata } from "next";
import OrganizerClient from "./OrganizerClient";

export const metadata: Metadata = {
  title: "Stubs for every guest · TicketStub",
  description: "Upload your guest list. Every guest gets their own stub.",
};

export default function OrganizerPage() {
  return <OrganizerClient />;
}
