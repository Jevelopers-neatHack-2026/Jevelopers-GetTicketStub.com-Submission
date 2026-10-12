"use client";
// Everything the cart puts in the corner, mounted once by NavFrame: the button (with the flight) and the mini cart.
import { CartButton } from "./CartButton";
import { MiniCart } from "./MiniCart";

export function CartCorner() {
  return (
    <>
      <CartButton />
      <MiniCart />
    </>
  );
}
