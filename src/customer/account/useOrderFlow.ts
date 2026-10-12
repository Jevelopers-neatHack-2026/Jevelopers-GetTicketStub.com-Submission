"use client";
// Placing an order with honest progress: the local record lands first, then the server is told. `placed` is
// null while the request is out (see `progress` for sending, "Still working..." and unknown), and carries a
// `code` when the server didn't take it, in which case `retry` sends the same order again (no second local copy).
import { useRef, useState } from "react";
import { useProgress } from "@/customer/feedback-messages/progress";
import { goToCheckout, newAttemptId, placeOrder, resendOrder, type Placed } from "./orders";

export function useOrderFlow() {
  const { state, run } = useProgress();
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [held, setHeld] = useState<Placed | null>(null);

  // What the caller does once the order is placed (empty the cart, tear the stub). Never run for a checkout that is
  // still to be paid, or one that couldn't start: the buyer may come back from the provider with nothing bought.
  const afterPlaced = useRef<(() => void) | undefined>(undefined);
  // One id per checkout attempt, kept until the order is placed, so a double press or a retry can't start a second checkout.
  const attempt = useRef<string | undefined>(undefined);

  function settle(p: Placed | undefined) {
    if (!p) return;
    // The server started a provider checkout: payment happens on the provider's page, which returns to /payment/return.
    if (goToCheckout(p)) return;
    if (p.code !== "payment_unavailable") {
      afterPlaced.current?.();
      afterPlaced.current = undefined;
    }
    if (!p.code) attempt.current = undefined;
    setHeld(p);
    setPlaced(p);
  }
  function place(draft: Parameters<typeof placeOrder>[0], onPlaced?: () => void) {
    afterPlaced.current = onPlaced;
    attempt.current ??= newAttemptId();
    const attemptId = attempt.current;
    setPlaced(null);
    void run(() => placeOrder(draft, attemptId)).then(settle);
  }
  const retry = held?.code
    ? () => {
        setPlaced(null);
        void run(() => resendOrder(held)).then(settle);
      }
    : undefined;
  return { placed, progress: state, place, retry };
}
