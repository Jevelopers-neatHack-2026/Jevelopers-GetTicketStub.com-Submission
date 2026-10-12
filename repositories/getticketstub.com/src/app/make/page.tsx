import type { Metadata } from "next";
import { StudioStart } from "@/customer/start/StudioStart";

export const metadata: Metadata = { title: "Make a stub · TicketStub" };

/** Make, inside the app: the same paste-a-ticket start as the landing page, with the sidebar around it. */
export default function MakePage() {
  return (
    <main className="desk-surface" style={{ minHeight: "100dvh" }}>
      <h1 className="visually-hidden">Make a stub</h1>
      <StudioStart fill />
    </main>
  );
}
