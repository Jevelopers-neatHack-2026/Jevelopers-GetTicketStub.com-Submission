import type { Metadata } from "next";
import UnclaimedClient from "./UnclaimedClient";

export const metadata: Metadata = { title: "An unclaimed seat · TicketStub" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function UnclaimedPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const seat = Number(typeof sp.seat === "string" ? sp.seat : NaN);
  return <UnclaimedClient id={decodeURIComponent(id)} seatIndex={Number.isFinite(seat) ? seat : undefined} />;
}
