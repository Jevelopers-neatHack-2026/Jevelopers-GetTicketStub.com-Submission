import type { Metadata } from "next";
import OrganizerClaimClient from "./OrganizerClaimClient";

export const metadata: Metadata = { title: "Claim your stub · TicketStub", robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function OrganizerClaimPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return <OrganizerClaimClient token={typeof sp.d === "string" ? sp.d : undefined} />;
}
