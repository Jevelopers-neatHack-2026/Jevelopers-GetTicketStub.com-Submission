"use client";
import { useEffect } from "react";
import { EmptyState, PaperLink, StampLink, TearAnchor } from "@/customer/pages/ui";
import { PaperButton } from "@/customer/desk/Desk";

/** A screen threw while rendering. Stubs live in this browser, so say so, offer a retry, then the way out. */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // The message and digest only: never props, bodies or tokens.
    console.error("[app] route error:", error.digest ?? error.message);
  }, [error]);
  return (
    <main className="desk-surface" role="alert" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "var(--ts-space-5)" }}>
      <EmptyState kind="stub" title="The press jammed." body="Something broke on our side. Your stubs are safe on this device. Try again, or head somewhere else.">
        <PaperButton onClick={() => retry()}>Try again</PaperButton>
        <StampLink href="/make">Make a stub</StampLink>
        <PaperLink href="/wall">Your wall</PaperLink>
        <TearAnchor href="/help">Help</TearAnchor>
      </EmptyState>
    </main>
  );
}
