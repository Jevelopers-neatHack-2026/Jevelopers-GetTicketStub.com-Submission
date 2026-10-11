import type { Metadata } from "next";
import MemoryPage from "./MemoryPage";

export const metadata: Metadata = {
  title: "A stub worth keeping · TicketStub",
  description: "Made with TicketStub.",
  robots: { index: false, follow: false }, // unlisted by default
};

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const sp = await searchParams;
  const to = typeof sp.to === "string" ? sp.to.slice(0, 40) : undefined;
  return <MemoryPage token={decodeURIComponent(token)} gift={sp.gift === "1"} giftTo={to} />;
}
