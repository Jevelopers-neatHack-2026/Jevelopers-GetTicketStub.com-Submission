import type { Metadata } from "next";
import "./admin.css";

// Never indexed; the page itself 404s for anyone who is not staff, so this only ever describes the staff view.
export const metadata: Metadata = { title: "Admin · TicketStub", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="ts-admin desk-surface" data-theme="light">
      {children}
    </main>
  );
}
