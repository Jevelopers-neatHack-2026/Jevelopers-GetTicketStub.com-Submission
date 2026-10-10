"use client";
// The desk map: every place as a small paper card, joined by dotted tear lines along the real flow.
import Link from "next/link";
import type { ComponentType } from "react";
import { FriendsIcon } from "@/customer/desk/icons";
import { CartIcon, GiftIcon, MakeIcon, OrganizerIcon, PrintIcon, ShareIcon, StyleIcon, TearIcon, WalletIcon, WallIcon } from "@/customer/nav/icons";
import { LeavesMark, PageShell, ui } from "@/customer/pages/ui";
import { useMounted } from "@/customer/pages/useMounted";
import { play, haptic } from "@/customer/studio/feedback";
import { encodeStub, loadWall } from "@/customer/studio/store";
import type { Stub } from "@/customer/studio/types";
import m from "./map.module.css";

interface Place {
  id: string;
  name: string;
  does: string;
  Icon: ComponentType;
  /** Where it goes. Places that need a stub get the most recent one. */
  to: (stub: Stub) => string;
  needsStub?: boolean;
}

const FLOW: Place[] = [
  { id: "make", name: "Make", does: "Paste your ticket link and start a stub.", Icon: MakeIcon, to: () => "/" },
  { id: "style", name: "Style", does: "Pick a look, a finish and your words.", Icon: StyleIcon, to: (s) => `/studio/${s.id}`, needsStub: true },
  { id: "tear", name: "Tear", does: "Tear the stub off to finish it.", Icon: TearIcon, to: (s) => `/studio/${s.id}`, needsStub: true },
  { id: "wall", name: "Wall", does: "Pin your stubs and open any one up close.", Icon: WallIcon, to: () => "/wall" },
];

const FORK: Place[] = [
  { id: "print", name: "Print", does: "Choose paper, finish and size, then check out.", Icon: PrintIcon, to: (s) => `/checkout/${s.id}`, needsStub: true },
  { id: "wallet", name: "Wallet", does: "Add the stub to your phone wallet.", Icon: WalletIcon, to: (s) => `/wallet/${s.id}`, needsStub: true },
  { id: "friends", name: "Friends", does: "Send a matching stub to each friend.", Icon: FriendsIcon, to: (s) => `/friends/${s.id}`, needsStub: true },
  { id: "gift", name: "Gift", does: "Give this stub to someone by name.", Icon: GiftIcon, to: (s) => `/gift/${s.id}`, needsStub: true },
  { id: "share", name: "Share", does: "Open the memory page you can send anywhere.", Icon: ShareIcon, to: (s) => `/s/${encodeStub(s)}`, needsStub: true },
];

const ALWAYS: Place[] = [
  { id: "cart", name: "Cart", does: "Review your prints before you pay.", Icon: CartIcon, to: () => "/cart" },
  { id: "organizer", name: "Organizer", does: "Print a run of stubs for your guests.", Icon: OrganizerIcon, to: () => "/organizer" },
];

function Card({ place, stub, index }: { place: Place; stub: Stub | undefined; index: number }) {
  const blocked = place.needsStub && !stub;
  const href = blocked ? "/" : place.to(stub as Stub);
  return (
    <li className={m.node} style={{ ["--i" as string]: index }}>
      <Link
        href={href}
        className={m.card}
        data-blocked={blocked ? "true" : undefined}
        onClick={() => {
          play("select", { emphasis: "subtle", direction: "forward" });
          haptic(6);
        }}
      >
        <span className={m.cardHead}>
          <span className={m.icon}>
            <place.Icon />
          </span>
          <span className={m.name}>{place.name}</span>
        </span>
        <span className={m.does}>{blocked ? "Make a stub first" : place.does}</span>
        <span className={m.go}>
          <LeavesMark />
        </span>
      </Link>
    </li>
  );
}

export default function MapClient() {
  const mounted = useMounted();
  // The most recent stub is first: upsertStub puts the one you touched at the front.
  const stub = mounted ? loadWall()[0] : undefined;
  return (
    <PageShell title="Desk map">
      <div className={m.page}>
        <div className={m.head}>
          <h1 className={ui.h1}>Desk map</h1>
          <p className={ui.lede}>Every place on your desk, joined along the way a stub travels.</p>
          {mounted ? (
            <p className={m.opens}>
              {stub ? (
                <>
                  <span className="desk-label">Opens</span> <span className={m.opensTitle}>{stub.event.title}</span>
                </>
              ) : (
                <span className="desk-label">No stub yet</span>
              )}
            </p>
          ) : null}
        </div>

        <ol className={m.path} aria-label="The way a stub travels">
          {FLOW.map((p, i) => (
            <Card key={p.id} place={p} stub={stub} index={i} />
          ))}
        </ol>

        <p className={m.forkLabel}>
          <span className="desk-label">Then, from the wall</span>
        </p>
        <ol className={m.fork} aria-label="From the wall">
          {FORK.map((p, i) => (
            <Card key={p.id} place={p} stub={stub} index={i + FLOW.length} />
          ))}
        </ol>

        <p className={m.forkLabel}>
          <span className="desk-label">Always at hand</span>
        </p>
        <ol className={m.always} aria-label="Always at hand">
          {ALWAYS.map((p, i) => (
            <Card key={p.id} place={p} stub={stub} index={i + FLOW.length + FORK.length} />
          ))}
        </ol>
      </div>
    </PageShell>
  );
}
