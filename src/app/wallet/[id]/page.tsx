import type { Metadata } from "next";
import WalletClient from "./WalletClient";

export const metadata: Metadata = { title: "Add to Wallet · TicketStub" };

export default async function WalletPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WalletClient id={decodeURIComponent(id)} />;
}
