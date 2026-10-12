"use client";
// The cart button: top right of every screen that has the nav, one paper button with the cart icon and a
// stamped count. It reads the cart live (storage event, this tab's cart event, every route change), opens
// the mini cart, and is where an added stub lands: a tiny copy flies in along a curve, then the count stamps up.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CartIcon } from "@/customer/nav/icons";
import { haptic, play } from "@/customer/studio/feedback";
import { StubView } from "@/customer/studio/stub/StubView";
import { useMounted } from "@/customer/pages/useMounted";
import { CART_FLY, closeMiniCart, openMiniCart, releaseCount, useCartCount, useMiniCartOpen, type CartFlyDetail } from "./cartStore";
import c from "./CartButton.module.css";

const FLIGHT_MS = 640;
const SAMPLES = 16;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** One stub in the air: a quadratic curve from where it was added to the button, shrinking as it goes. */
function Flight({ detail, onDone }: { detail: CartFlyDetail; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const target = document.querySelector("[data-cart-button]")?.getBoundingClientRect();
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      if (detail.hold) releaseCount(1);
      onDone();
    };
    if (!el || !target) {
      land();
      return;
    }
    const box = el.getBoundingClientRect();
    const x0 = detail.from.left + detail.from.width / 2;
    const y0 = detail.from.top + detail.from.height / 2;
    const x1 = target.left + target.width / 2;
    const y1 = target.top + target.height / 2;
    const cx = (x0 + x1) / 2 + (x1 - x0) * 0.1;
    const cy = Math.min(y0, y1) - 90;
    const frames: Keyframe[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const p = ease(t);
      const x = (1 - p) * (1 - p) * x0 + 2 * (1 - p) * p * cx + p * p * x1;
      const y = (1 - p) * (1 - p) * y0 + 2 * (1 - p) * p * cy + p * p * y1;
      const scale = 1 - 0.72 * p;
      frames.push({ transform: `translate(${x - box.width / 2}px, ${y - box.height / 2}px) scale(${scale}) rotate(${-6 + 14 * p}deg)`, opacity: t > 0.85 ? 1 - (t - 0.85) / 0.15 * 0.6 : 1, offset: t });
    }
    const anim = el.animate(frames, { duration: FLIGHT_MS, easing: "linear", fill: "forwards" });
    anim.onfinish = land;
    // a flight the browser never finishes (a background tab) must not hold the count back
    const safety = setTimeout(land, FLIGHT_MS + 800);
    return () => {
      anim.cancel();
      clearTimeout(safety);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className={c.flight} aria-hidden>
      <StubView stub={detail.stub} size="sm" />
    </div>
  );
}

export function CartButton() {
  const mounted = useMounted();
  const real = useCartCount();
  const count = mounted ? real : 0;
  const open = useMiniCartOpen();
  const [seen, setSeen] = useState<number | null>(null);
  const [bump, setBump] = useState(0);
  const [flights, setFlights] = useState<{ id: number; detail: CartFlyDetail }[]>([]);
  const nextId = useRef(0);

  // The count stamps when it goes up (not on the first read after load).
  if (mounted && seen === null) setSeen(count);
  else if (mounted && seen !== null && count !== seen) {
    setSeen(count);
    if (count > seen) setBump((b) => b + 1);
  }
  useEffect(() => {
    if (!bump) return;
    play("stamp", { emphasis: "subtle" });
    haptic(12);
  }, [bump]);

  useEffect(() => {
    const onFly = (e: Event) => {
      // reduced motion: no flight, the count crossfades in instead (flyToCart already took no hold)
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const detail = (e as CustomEvent<CartFlyDetail>).detail;
      setFlights((f) => [...f, { id: nextId.current++, detail }]);
    };
    window.addEventListener(CART_FLY, onFly);
    return () => window.removeEventListener(CART_FLY, onFly);
  }, []);

  return (
    <>
      <button
        type="button"
        className={c.btn}
        data-cart-button
        data-empty={count === 0 ? "true" : undefined}
        aria-label={`Cart, ${count > 99 ? "99+" : count} ${count === 1 ? "stub" : "stubs"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? closeMiniCart() : openMiniCart())}
      >
        <CartIcon />
        <span key={bump} className={c.count} data-bump={bump > 0 ? "true" : undefined} aria-hidden>
          {count > 99 ? "99+" : count}
        </span>
      </button>
      {flights.map((f) => (
        <Flight key={f.id} detail={f.detail} onDone={() => setFlights((all) => all.filter((x) => x.id !== f.id))} />
      ))}
    </>
  );
}
