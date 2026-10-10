"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { play } from "@/customer/studio/feedback";
import { formatMoney } from "@/customer/studio/types";
import { PageShell, SandboxBadge, ui } from "@/customer/pages/ui";
import { loadCart, updateSeat, type CartItem } from "@/customer/pages/commerce";
import { useMounted } from "@/customer/pages/useMounted";
import s from "./unclaimed.module.css";

const TIMELINE = [
  { day: "Day 0", text: "You bought the set. Claim links went out." },
  { day: "Days 1–6", text: "Friends claim their seats and add their name." },
  { day: "Day 7", text: "Still open? You decide what happens to the seat." },
];

export default function UnclaimedClient({ id, seatIndex }: { id: string; seatIndex?: number }) {
  const router = useRouter();
  const mounted = useMounted();
  const [item, setItem] = useState<CartItem | null | undefined>(undefined);

  if (mounted && item === undefined) setItem(loadCart().find((c) => c.id === id || c.stubId === id) ?? null);

  if (!mounted || item === undefined) return <PageShell back={{ href: "/cart", label: "Cart" }}>{null}</PageShell>;

  const idx = seatIndex ?? item?.seats.findIndex((x) => !x.claimed && !x.decision) ?? -1;
  const seat = item && idx >= 0 ? item.seats[idx] : undefined;

  if (!item || !seat) {
    return (
      <PageShell back={{ href: "/cart", label: "Cart" }}>
        <div className={ui.error}>
          <h1 className={ui.h2}>Every seat in this set is sorted.</h1>
          <Link className="btn btn-primary" href="/cart">
            Back to your cart
          </Link>
        </div>
      </PageShell>
    );
  }

  const label = `${seat.name}${seat.seat ? ` · ${seat.seat}` : ""}`;

  function decide(decision: "seat-only" | "drop") {
    updateSeat(item!.id, idx, { decision });
    play(decision === "drop" ? "tear" : "stamp");
    router.push("/cart");
  }

  return (
    <PageShell back={{ href: "/cart", label: "Cart" }} narrow>
      <div className={s.wrap}>
        <p className="label">{item.title} · matching set</p>
        <h1 className={ui.h1}>{seat.name}&apos;s seat is still open.</h1>
        <p className={ui.muted}>
          {label}. Nobody has claimed it after 7 days. Pick what happens to it.
        </p>

        <section className={s.timeline} aria-labelledby="tl-h">
          <h2 id="tl-h" className={s.tlTitle}>
            Timeline <span className="provenance">simulated</span>
          </h2>
          <ol className={s.steps}>
            {TIMELINE.map((t, i) => (
              <li key={t.day} className={i === TIMELINE.length - 1 ? s.now : undefined}>
                <span className={s.day}>{t.day}</span>
                <span>{t.text}</span>
              </li>
            ))}
          </ol>
          <p className={ui.muted}>In this demo, day 7 is today.</p>
        </section>

        <div className={s.choices}>
          <button type="button" className={`${s.choice}`} onClick={() => decide("seat-only")}>
            <strong>Print it with the seat number only</strong>
            <span>The stub prints without a name. You can hand it over later.</span>
          </button>
          <Link
            className={s.choice}
            href={`/gift/${encodeURIComponent(item.stubId)}?for=${encodeURIComponent(seat.name)}&from=cart&item=${encodeURIComponent(item.id)}&seat=${idx}`}
          >
            <strong>Gift it by name</strong>
            <span>Send the stub to someone as a gift.</span>
          </Link>
          <button type="button" className={s.choice} onClick={() => decide("drop")}>
            <strong>Drop it and get a refund</strong>
            <span>
              {formatMoney(item.unitMinor)} back to you. <SandboxBadge text="Sandbox refund · no real money moves" />
            </span>
          </button>
        </div>
      </div>
    </PageShell>
  );
}
