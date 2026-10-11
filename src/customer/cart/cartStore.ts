"use client";
// The cart as the whole app sees it: the items, the count the corner button shows, the mini cart's open
// state, and the add-to-cart flight. The data lives in commerce.ts (localStorage); this reads it live on
// the storage event (other tabs) and CART_EVENT (this tab), so every screen agrees.
import { useMemo, useSyncExternalStore } from "react";
import { CART_EVENT, CART_KEY, addToCart, type CartItem } from "@/customer/pages/commerce";
import type { Stub } from "@/customer/studio/types";

/** Fired on window when a stub should fly to the cart. The corner button answers it. */
export const CART_FLY = "ticketstub:cart-fly";
export interface CartFlyDetail {
  from: DOMRect;
  stub: Stub;
  /** The flight is holding one off the count; release it on landing. */
  hold: boolean;
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  window.addEventListener(CART_EVENT, cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
    window.removeEventListener(CART_EVENT, cb);
  };
}

function rawCart(): string {
  try {
    return window.localStorage.getItem(CART_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parse(raw: string): CartItem[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function useCartItems(): CartItem[] {
  const raw = useSyncExternalStore(subscribe, rawCart, () => "[]");
  return useMemo(() => parse(raw), [raw]);
}

// While a stub is in the air the count waits for it: it stamps up when the stub lands, not before.
let held = 0;
export const holdCount = (n: number) => {
  held += n;
  emit();
};
export const releaseCount = (n: number) => {
  held = Math.max(0, held - n);
  emit();
};

/** The count the corner button shows. */
export function useCartCount(): number {
  return useSyncExternalStore(
    (cb) => subscribe(cb),
    () => Math.max(0, parse(rawCart()).length - held),
    () => 0,
  );
}

// ---------- the mini cart ----------
let miniOpen = false;
export const openMiniCart = () => {
  miniOpen = true;
  emit();
};
export const closeMiniCart = () => {
  miniOpen = false;
  emit();
};
export function useMiniCartOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => miniOpen,
    () => false,
  );
}

// ---------- add to cart, with the flight ----------
/**
 * Send a tiny copy of `stub` from `fromEl` to the cart button. Call it right after addToCart; pass
 * `grew` false when the add replaced a line (the count does not change, so it must not wait).
 * With no corner button on the page (the landing page) nothing flies.
 */
export function flyToCart(fromEl: Element | null, stub: Stub, grew = true): void {
  if (typeof document === "undefined" || !fromEl || !document.querySelector("[data-cart-button]")) return;
  const hold = grew && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (hold) holdCount(1);
  window.dispatchEvent(new CustomEvent<CartFlyDetail>(CART_FLY, { detail: { from: fromEl.getBoundingClientRect(), stub, hold } }));
}

/** The one way screens add: saves the line, then flies the stub to the corner. The caller stays on the page. */
export function addToCartAndFly(item: CartItem, stub: Stub, fromEl: Element | null): void {
  const before = parse(rawCart()).length;
  addToCart(item);
  flyToCart(fromEl, stub, parse(rawCart()).length > before);
}
