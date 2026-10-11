import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchShows } from "./SearchShows";

export const metadata: Metadata = {
  title: "Search for your show · TicketStub",
};

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchShows />
    </Suspense>
  );
}
