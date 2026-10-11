import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT, LegalPage } from "@/customer/pages/Legal";

export const metadata: Metadata = { title: "Privacy · TicketStub", description: "What TicketStub keeps, where it lives, and how to delete it." };

export default function PrivacyPage() {
  return (
    <LegalPage
      kicker="Privacy"
      title="Your stubs are yours."
      lede="Here is what we keep, where it lives, and how to make it all go away."
      updated="10 Oct 2026"
      other={{ href: "/terms", label: "Read the terms." }}
      sections={[
        {
          title: "What we store",
          body: (
            <>
              <p>When you sign in, we keep your email address. We also keep what you save to your wall: your stubs and their art, your orders, and the guest names (and seats) an organizer adds to an event.</p>
              <p>We keep a sign-in cookie so you stay signed in for 90 days, and a second cookie that tells this device apart, so we can cap how much art one device makes in a day.</p>
            </>
          ),
        },
        {
          title: "Where it lives",
          body: <p>On our own server, in a SQLite database. Art you save is stored as files next to it. Nothing is sold, and nothing is used for ads.</p>,
        },
        {
          title: "What stays on your device",
          body: <p>Signed out, your stubs live only in this browser. Photos you add to a stub never leave your device. Your cart, sound setting and drafts stay here too.</p>,
        },
        {
          title: "Payments",
          body: <p>Payments are a sandbox. Nothing is charged, and we never ask for card details.</p>,
        },
        {
          title: "Who else sees something",
          body: (
            <ul>
              <li>Resend sends our email, so it sees your address and the message.</li>
              <li>OpenAI makes the art, so it sees the show details we turn into a prompt (title, venue, date, vibe), not your email.</li>
              <li>When we read a show&apos;s page or write the margin notes, the show details go to Anthropic. Lookups can also reach Ticketmaster and public weather and map services.</li>
            </ul>
          ),
        },
        {
          title: "Delete everything",
          body: (
            <p>
              Open <Link href="/account">your account</Link> and choose &ldquo;Delete my account&rdquo;. Your wall, share links and organizer events are removed from our server, and your receipts are kept without your email. Stubs on this device stay until you clear them here. To ask for anything else, write to{" "}
              <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
            </p>
          ),
        },
      ]}
    />
  );
}
