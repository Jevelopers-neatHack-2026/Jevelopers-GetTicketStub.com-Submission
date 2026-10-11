import type { Metadata } from "next";
import GiftClient from "./GiftClient";

export const metadata: Metadata = { title: "Send it as a gift · TicketStub" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function GiftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const seat = Number(str(sp.seat));
  return (
    <GiftClient
      id={decodeURIComponent(id)}
      forName={str(sp.for)?.slice(0, 32)}
      cartItem={str(sp.from) === "cart" ? str(sp.item) : undefined}
      seatIndex={Number.isFinite(seat) ? seat : undefined}
    />
  );
}
