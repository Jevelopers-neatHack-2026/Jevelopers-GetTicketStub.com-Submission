import type { Metadata } from "next";
import PublicWall from "./PublicWall";

export const metadata: Metadata = { title: "A TicketStub wall", robots: { index: false, follow: false } };

export default async function PublicWallPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicWall token={decodeURIComponent(token)} />;
}
