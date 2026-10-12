import type { Metadata } from "next";
import WallClient from "./WallClient";

export const metadata: Metadata = { title: "Your wall · TicketStub" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function WallPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return <WallClient emailSent={sp.email === "sent"} pinnedId={one(sp.pinned)} liftId={one(sp.lift)} />;
}
