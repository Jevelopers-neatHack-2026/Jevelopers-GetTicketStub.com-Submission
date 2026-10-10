import "server-only";
// The storage interface. Routes and auth only talk to this, so Postgres can replace SQLite later by
// implementing it. Every method is async for that reason, even though node:sqlite is synchronous.
import type { Order } from "@/customer/pages/commerce";
import type { Stub } from "@/customer/studio/types";

export interface Account {
  id: string;
  email: string;
}

export interface LoginLinkRecord {
  email: string;
  returnTo: string;
  reason: string;
  /** Set for an email-change link: the account that asked for it. */
  accountId?: string | null;
  /** The share token of the stub being saved, so the confirm page and email can show it. */
  shareToken?: string | null;
}

export interface WallRow {
  stub: Stub;
  updatedAt: number;
}

export interface WallState {
  stubs: Stub[];
  /** Tombstoned ids. */
  deleted: string[];
}

export interface ShareRecord {
  token: string;
  stub: Stub;
}

export interface ClaimView {
  eventId: string;
  stub: Stub;
  guestName: string;
  seat?: string;
  expiresAt: number;
  claimedBy: string | null;
  /** The id of the stub the claim created on the claimer's wall. */
  claimedStubId: string | null;
}

export interface NewClaim {
  tokenHash: string;
  guestName: string;
  seat?: string;
}

export type ClaimResult =
  | { status: "claimed" | "already"; stub: Stub }
  | { status: "taken" }
  | { status: "expired" }
  | { status: "missing" };

export interface Storage {
  // accounts
  findOrCreateAccount(email: string, now: number): Promise<Account>;
  getAccount(id: string): Promise<Account | null>;
  changeEmail(accountId: string, email: string): Promise<"changed" | "taken" | "missing">;
  /**
   * Removes the account and everything it owns. Orders stay, anonymised (email removed, account id nulled).
   * Returns the stored file names (art) that nothing references any more, for the caller to unlink.
   */
  deleteAccount(accountId: string, email: string): Promise<string[]>;

  // magic links: only hashes are stored
  createLoginLink(tokenHash: string, link: LoginLinkRecord, now: number, expiresAt: number): Promise<void>;
  /** Looks a link up without consuming it. Null when unknown, used or expired. */
  peekLoginLink(tokenHash: string, now: number): Promise<(LoginLinkRecord & { kind: "signin" | "email" }) | null>;
  /**
   * Marks the link used and returns it, or null when unknown, used or expired. Atomic.
   * "signin" accepts sign-in links only; "email" accepts email-change links only, so one can't stand in for the other.
   */
  consumeLoginLink(tokenHash: string, now: number, kind: "signin" | "email"): Promise<LoginLinkRecord | null>;

  // sessions: only hashes are stored
  createSession(tokenHash: string, accountId: string, now: number, expiresAt: number): Promise<void>;
  getSessionAccount(tokenHash: string, now: number): Promise<Account | null>;
  deleteSession(tokenHash: string): Promise<void>;
  prune(now: number): Promise<void>;

  // wall
  /** Merges per id: the newer updatedAt wins, a tombstone wins over an older stub. Returns the whole wall. */
  syncWall(accountId: string, stubs: Stub[], deleted: string[], now: number): Promise<WallState>;
  listWall(accountId: string): Promise<Stub[]>;
  setWallPublic(accountId: string, isPublic: boolean, newToken: string): Promise<string | null>;
  getWallPublic(accountId: string): Promise<{ isPublic: boolean; token: string | null }>;
  getPublicWall(token: string): Promise<Stub[] | null>;

  // orders
  createOrder(order: Order, accountId: string | null, email: string | null): Promise<void>;
  listOrders(accountId: string, email: string): Promise<Order[]>;

  // shares
  /** The same owner and stub id always get the same token; the snapshot is replaced each time. */
  upsertShare(ownerKey: string, stub: Stub, newToken: string, now: number): Promise<string>;
  getShare(token: string): Promise<Stub | null>;

  // organizer events and claims
  createEvent(
    accountId: string,
    event: { id: string; title: string; stub: Stub; expiresAt: number },
    claims: NewClaim[],
    now: number,
  ): Promise<void>;
  getClaim(tokenHash: string): Promise<ClaimView | null>;
  /** Adds the guest's stub to the account's wall. Idempotent for the same account. */
  claim(tokenHash: string, accountId: string, guestStub: (view: ClaimView) => Stub, now: number): Promise<ClaimResult>;
}
