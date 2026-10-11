import type { Metadata } from "next";
import { Suspense } from "react";
import { NewStub } from "./NewStub";

export const metadata: Metadata = {
  title: "Building your stub · TicketStub",
};

export default function NewPage() {
  return (
    <Suspense fallback={<div className="ts-night" style={{ minHeight: "100dvh", background: "var(--ts-bg)" }} />}>
      <NewStub />
    </Suspense>
  );
}
