import type { Metadata } from "next";
import FriendsClient from "./FriendsClient";

export const metadata: Metadata = { title: "Send matching stubs · TicketStub" };

export default async function FriendsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FriendsClient id={decodeURIComponent(id)} />;
}
