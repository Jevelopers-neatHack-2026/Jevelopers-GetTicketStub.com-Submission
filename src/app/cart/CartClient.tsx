"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { FitBox } from "@/customer/pages/FitBox";
import { play, haptic } from "@/customer/studio/feedback";
import { getStub, upsertStub } from "@/customer/studio/store";
import { MATERIALS, formatMoney, type Stub } from "@/customer/studio/types";
import { PageShell, SandboxBadge, ui } from "@/customer/pages/ui";
import { SIZE_LABEL, addOrder, billableSeats, cartTotals, loadCart, saveCart, type CartItem, type CartSeat } from "@/customer/pages/commerce";
import { useMounted } from "@/customer/pages/useMounted";
import s from "./cart.module.css";

function seatStatus(seat: CartSeat): string {
  if (seat.claimed) return "Claimed";
  if (seat.decision === "seat-only") return "Prints with the seat number only";
  if (seat.decision === "gift") return "Sent as a gift";
  if (seat.decision === "drop") return "Dropped · refunded (sandbox)";
  return "Not claimed yet";
}

export default function CartClient() {
  const router = useRouter();
  const mounted = useMounted();
  const [items, setItems] = useState<CartItem[]>([]);
  const [stubs, setStubs] = useState<Record<string, Stub | undefined>>({});
  const [paying, setPaying] = useState(false);

  const [loaded, setLoaded] = useState(false);
  if (mounted && !loaded) {
    const cart = loadCart();
    setLoaded(true);
    setItems(cart);
    setStubs(Object.fromEntries(cart.map((c) => [c.stubId, getStub(c.stubId)])));
  }

  function remove(id: string) {
    const next = items.filter((c) => c.id !== id);
    setItems(next);
    saveCart(next);
  }

  function pay(method: "apple-pay" | "google-pay") {
    setPaying(true);
    const totals = cartTotals(items);
    addOrder({
      stubIds: items.map((i) => i.stubId),
      lines: items.map((i) => ({ title: i.title, material: i.material, finish: i.finish, size: i.size, totalMinor: i.unitMinor * billableSeats(i) })),
      totalMinor: totals.totalMinor,
      method,
    });
    for (const i of items) {
      const st = stubs[i.stubId];
      if (st) upsertStub({ ...st, material: i.material, finish: i.finish, torn: true });
    }
    saveCart([]);
    play("stamp");
    haptic([18, 40, 28]);
    router.push("/wall?email=sent");
  }

  const totals = cartTotals(items);

  return (
    <PageShell back={{ href: "/wall", label: "Wall" }} title="Your cart" right={<SandboxBadge />}>
      {!mounted ? null : items.length === 0 ? (
        <div className={ui.error}>
          <h1 className={ui.h2}>Your cart is empty.</h1>
          <p className={ui.muted}>Add a stub from your wall, or print a matching set for the people you went with.</p>
          <Link className="btn btn-primary" href="/wall">
            Open your wall
          </Link>
        </div>
      ) : (
        <div className={s.layout}>
          <section aria-labelledby="cart-h" className={s.items}>
            <h1 id="cart-h" className={ui.h1}>
              Your cart
            </h1>
            <ul className={s.list}>
              {items.map((item) => {
                const st = stubs[item.stubId];
                const billable = billableSeats(item);
                return (
                  <li key={item.id} className={s.item}>
                    <div className={s.itemHead}>
                      <div className={s.thumb}>{st ? (
                          <FitBox>
                            <StubView stub={st} size="sm" />
                          </FitBox>
                        ) : <div className={s.thumbEmpty} aria-hidden="true" />}</div>
                      <div className={s.itemInfo}>
                        <h2 className={s.itemTitle}>{item.title}</h2>
                        <p className={ui.muted}>
                          {MATERIALS.find((m) => m.id === item.material)?.label} · {item.finish} · {SIZE_LABEL[item.size]}
                        </p>
                        <p className="num">
                          {billable > 1 ? `${billable} × ${formatMoney(item.unitMinor)} = ` : ""}
                          <strong>{formatMoney(item.unitMinor * billable)}</strong>
                        </p>
                        <button type="button" className={`btn btn-quiet ${s.remove}`} onClick={() => remove(item.id)}>
                          Remove
                        </button>
                      </div>
                    </div>
                    {item.seats.length > 1 ? (
                      <div className={s.seats}>
                        <p className="label">Matching set · {item.seats.length} seats</p>
                        <ul className={s.seatList}>
                          {item.seats.map((seat, i) => {
                            const open = !seat.claimed && !seat.decision;
                            const label = `${seat.name}${seat.seat ? ` · ${seat.seat}` : ""}`;
                            return (
                              <li key={i}>
                                {open ? (
                                  <Link className={`${s.seatRow} ${s.seatOpen}`} href={`/cart/unclaimed/${item.id}?seat=${i}`}>
                                    <span>{label}</span>
                                    <span className={s.seatStatus}>Not claimed yet · decide ›</span>
                                  </Link>
                                ) : (
                                  <div className={s.seatRow}>
                                    <span>{label}</span>
                                    <span className={s.seatStatus}>{seatStatus(seat)}</span>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <aside className={`${ui.card} ${s.summary}`} aria-labelledby="sum-h">
            <h2 id="sum-h" className={ui.h2}>
              Summary
            </h2>
            <dl className={s.dl}>
              <div>
                <dt>Stubs</dt>
                <dd className="num">{formatMoney(totals.itemsMinor)}</dd>
              </div>
              {totals.shippingMinor ? (
                <div>
                  <dt>
                    Shipping <span className="provenance">estimated</span>
                  </dt>
                  <dd className="num">{formatMoney(totals.shippingMinor)}</dd>
                </div>
              ) : null}
              <div className={s.total}>
                <dt>Total</dt>
                <dd className="num">{formatMoney(totals.totalMinor)}</dd>
              </div>
            </dl>
            <p className={ui.muted}>Quote expires in 15 min. A quote is not a charge.</p>
            <button type="button" className={`btn btn-block ${s.pay}`} onClick={() => pay("apple-pay")} disabled={paying}>
              Pay with Apple Pay
            </button>
            <button type="button" className={`btn btn-block ${s.pay}`} onClick={() => pay("google-pay")} disabled={paying}>
              Pay with Google Pay
            </button>
            <p className={s.sandboxNote}>Sandbox · no real charge. We&apos;ll email a link to your wall.</p>
          </aside>
        </div>
      )}
    </PageShell>
  );
}
