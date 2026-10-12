import type { Metadata } from "next";
import { Suspense } from "react";
import { NewStub } from "./NewStub";

export const metadata: Metadata = {
  title: "Building your stub · TicketStub",
};

export default function NewPage() {
  return (
    <Suspense fallback={<div className="desk-surface" style={{ minHeight: "100dvh" }} />}>
      <NewStub />
    </Suspense>
  );
}
