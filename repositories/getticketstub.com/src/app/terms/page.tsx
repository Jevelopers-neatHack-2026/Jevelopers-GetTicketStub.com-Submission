import type { Metadata } from "next";
import { CONTACT, LegalPage } from "@/customer/pages/Legal";

export const metadata: Metadata = { title: "Terms · TicketStub", description: "Plain terms for the TicketStub sandbox demo." };

export default function TermsPage() {
  return (
    <LegalPage
      kicker="Terms"
      title="A demo, in plain words."
      lede="TicketStub is a hackathon demo. Here is what that means for you."
      updated="10 Oct 2026"
      other={{ href: "/privacy", label: "Read the privacy note." }}
      sections={[
        {
          title: "It's a demo",
          body: <p>We built TicketStub for a hackathon. It can change, break or disappear without notice, and we make no promises that it will keep running.</p>,
        },
        {
          title: "No real charges",
          body: <p>Every price is a sandbox price. Nothing is charged, and nothing is printed or shipped.</p>,
        },
        {
          title: "You keep your stubs",
          body: <p>What you make is yours, and so is the art made for you. By saving it, you let us store and show it where you ask us to: your wall, share links and emails. Delete your account and we remove it.</p>,
        },
        {
          title: "Be decent",
          body: <p>Use your own tickets and guest lists, or ones you have the right to use. Don&apos;t use TicketStub to harass anyone or to break the law, and don&apos;t try to overload it. We may limit or remove accounts that do.</p>,
        },
        {
          title: "No warranty",
          body: (
            <p>
              TicketStub is provided as it is. Facts we find about a show can be wrong, so check them before you rely on them. This page is a plain summary, not legal advice. Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> with any question.
            </p>
          ),
        },
      ]}
    />
  );
}
