"use client";
// The account API client. Every call fails soft: a missing server, a network error or an odd reply
// becomes an ApiError the caller can ignore, so the signed-out, local-only app keeps working.
import type { Order } from "@/customer/pages/commerce";
import type { Stub } from "@/customer/studio/types";
import { SAVING_OFF_CODE, markSavingOff } from "./saving";

export interface Account {
  id: string;
  email: string;
}
export type LinkReason = "save" | "checkout" | "claim";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network", "We couldn't reach the server.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON: a 404 page, or no server at all */
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    if (err?.code === SAVING_OFF_CODE) markSavingOff();
    throw new ApiError(err?.code ?? "unavailable", err?.message ?? "Something went wrong.", res.status);
  }
  if (data === null || typeof data !== "object") throw new ApiError("unavailable", "The server sent something we didn't expect.", res.status);
  return data as T;
}

export interface SyncReply {
  stubs: Stub[];
  deleted: string[];
  now: number;
}
export interface ClaimInfo {
  stub: Stub;
  guestName: string;
  seat?: string;
  claimed: boolean;
  expired: boolean;
}
export interface GiftInfo {
  stub: Stub;
  to: string;
  message: string;
  openedAt: number | null;
}
export interface OrganizerEventReply {
  eventId: string;
  claims: { token: string; name: string; seat?: string }[];
}

export const api = {
  me: async () => {
    const res = await call<{ account: Account | null; storage?: "ok" | "unavailable" }>("GET", "/api/auth/me");
    if (res.storage === "unavailable") markSavingOff();
    return res.account;
  },
  link: (email: string, reason: LinkReason, returnTo?: string) => call<{ ok: true; sandbox?: true; devLink?: string }>("POST", "/api/auth/link", { email, reason, returnTo }),
  signOut: () => call<{ ok: true }>("POST", "/api/auth/signout", {}),
  sync: (stubs: Stub[], deleted: string[]) => call<SyncReply>("POST", "/api/wall/sync", { stubs, deleted }),
  setPublic: (isPublic: boolean) => call<{ token: string | null }>("PUT", "/api/wall/public", { isPublic }),
  /** "Stop sharing" the public page: private, and the old link dies for good. */
  stopSharingWall: () => call<{ token: string | null }>("PUT", "/api/wall/public", { isPublic: false, rotate: true }),
  /** "Stop sharing" one stub: its share link answers 404 from now on. */
  stopSharing: (stubId: string) => call<{ ok: true; revoked: boolean }>("POST", "/api/share/revoke", { stubId }),
  /** A gift: the message is stored under its own token, never in a share. The reply's sharePath is the link to hand over. */
  createGift: (stubId: string, to: string, message: string) => call<{ giftToken: string; sharePath: string }>("POST", "/api/gift", { stub: stubId, to, message }),
  gift: (giftToken: string) => call<GiftInfo>("GET", `/api/gift/${encodeURIComponent(giftToken)}`),
  /** Takes a gift back: the message is deleted and the link answers 404. */
  revokeGift: (giftToken: string) => call<{ ok: true; revoked: boolean }>("DELETE", `/api/gift/${encodeURIComponent(giftToken)}`),
  publicWall: (token: string) => call<{ stubs: Stub[] }>("GET", `/api/u/${encodeURIComponent(token)}`),
  order: (order: Omit<Order, "id" | "mode" | "createdAt">) => call<{ order: Order; checkoutUrl?: string }>("POST", "/api/orders", { order }),
  share: (stub: Stub) => call<{ token: string }>("POST", "/api/share", { stub }),
  sharedStub: (token: string) => call<{ stub: Stub }>("GET", `/api/share/${encodeURIComponent(token)}`),
  publishEvent: (title: string, stub: Stub, guests: { name: string; seat?: string }[], expiresInDays?: number) =>
    call<OrganizerEventReply>("POST", "/api/organizer/events", { title, stub, guests, expiresInDays }),
  claimInfo: (token: string) => call<ClaimInfo>("GET", `/api/claim/${encodeURIComponent(token)}`),
  orders: async () => (await call<{ orders: Order[] }>("GET", "/api/orders")).orders,
  changeEmail: (email: string) => call<{ ok: true; sandbox?: true; devLink?: string }>("POST", "/api/account/email", { email }),
  deleteAccount: (confirm: string) => call<{ ok: true }>("DELETE", "/api/account", { confirm }),
  claim: (token: string) => call<{ stub: Stub }>("POST", `/api/claim/${encodeURIComponent(token)}`, {}),
};

export const EMAIL_RE = /^\S+@\S+\.\S+$/;
