import type { Metadata } from "next";
import MapClient from "./MapClient";

export const metadata: Metadata = { title: "Desk map · TicketStub" };

export default function MapPage() {
  return <MapClient />;
}
