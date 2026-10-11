import type { Metadata } from "next";
import { EmptyState, PaperLink, StampLink, TearAnchor } from "@/customer/pages/ui";

export const metadata: Metadata = { title: "Not on the desk · TicketStub" };

/** Any route we don't have, and any page that calls notFound() (a revoked share, a private area). It never says which. */
export default function NotFound() {
  return (
    <main className="desk-surface" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "var(--ts-space-5)" }}>
      <EmptyState kind="stub" title="That page isn't on the desk." body="The link may be old, or the page may have moved. Nothing of yours is missing.">
        <StampLink href="/make">Make a stub</StampLink>
        <PaperLink href="/wall">Your wall</PaperLink>
        <TearAnchor href="/help">Help</TearAnchor>
      </EmptyState>
    </main>
  );
}
