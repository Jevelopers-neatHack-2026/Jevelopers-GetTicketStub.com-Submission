import type { Metadata } from "next";
import WallClient from "./WallClient";

export const metadata: Metadata = { title: "Your wall · TicketStub" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function WallPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return <WallClient emailSent={sp.email === "sent"} />;
}
