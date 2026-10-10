"use client";
// The account, one quiet line for the sidebar foot: who is signed in (links to /account) with Sign out,
// or an offer to save once there is a wall to save. `compact` is the icon-only form for the rail.
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { loadWall } from "@/customer/studio/store";
import { openSignIn } from "./signin";
import { useAccount } from "./useAccount";
import s from "./account.module.css";

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.4" />
      <path d="M5.5 19.5c.8-3.4 3.3-5 6.5-5s5.7 1.6 6.5 5" />
    </svg>
  );
}

export function AccountLine({ compact }: { compact?: boolean }) {
  const { status, account, signOut } = useAccount();
  const stubCount = useSyncExternalStore(subscribeStorage, () => loadWall().length, () => 0);
  if (status === "loading") return null;

  if (account) {
    if (compact) {
      return (
        <Link href="/account" className={s.navIcon} aria-label={`Signed in as ${account.email}. Your account`} title={`Signed in as ${account.email}`}>
          <PersonIcon />
        </Link>
      );
    }
    return (
      <div className={s.nav}>
        <p className={s.navLine}>
          Signed in as{" "}
          <Link href="/account" className={s.navEmail}>
            {account.email}
          </Link>
        </p>
        <button type="button" className={s.navLink} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  if (stubCount === 0) return null;
  if (compact) {
    return (
      <button type="button" className={s.navIcon} aria-label="Save your wall" title="Save your wall" onClick={() => openSignIn({ reason: "save" })}>
        <PersonIcon />
      </button>
    );
  }
  return (
    <div className={s.nav}>
      <button type="button" className={s.navLink} onClick={() => openSignIn({ reason: "save" })}>
        Save your wall
      </button>
    </div>
  );
}
