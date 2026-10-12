import type { Metadata } from "next";
import GuestClaimClient from "./GuestClaimClient";

export const metadata: Metadata = { title: "Claim your stub · TicketStub", robots: { index: false, follow: false } };

export default async function GuestClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <GuestClaimClient token={decodeURIComponent(token)} />;
}
