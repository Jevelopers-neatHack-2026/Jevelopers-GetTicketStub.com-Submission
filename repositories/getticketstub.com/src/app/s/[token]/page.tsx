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
  // ?gift=1&to=<name> is the older wrapped link (no message). ?gift=<token> is a gift's own claim link, which carries the message.
  const g = typeof sp.gift === "string" ? sp.gift : "";
  const giftToken = /^[A-Za-z0-9_-]{6,64}$/.test(g) ? g : undefined;
  return <MemoryPage token={decodeURIComponent(token)} gift={g === "1"} giftTo={to} giftToken={giftToken} wrap={sp.wrap !== "0"} />;
}
