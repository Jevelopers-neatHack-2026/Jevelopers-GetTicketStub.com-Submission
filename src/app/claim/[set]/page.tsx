import type { Metadata } from "next";
import ClaimClient from "./ClaimClient";

export const metadata: Metadata = { title: "Claim your stub · TicketStub", robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ClaimPage({ params, searchParams }: { params: Promise<{ set: string }>; searchParams: SP }) {
  const { set } = await params;
  const sp = await searchParams;
  return <ClaimClient set={decodeURIComponent(set)} from={typeof sp.from === "string" ? sp.from : undefined} />;
}
