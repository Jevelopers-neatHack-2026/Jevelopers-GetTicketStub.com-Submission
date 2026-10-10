"use client";
// The account, one quiet line for the sidebar foot: who is signed in (links to /account) with Sign out,
// or an offer to save once there is a wall to save. The rail has no account line: its Account row carries the state.
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

export function AccountLine() {
  const { status, account, signOut } = useAccount();
  const stubCount = useSyncExternalStore(subscribeStorage, () => loadWall().length, () => 0);
  if (status === "loading") return null;

  if (account) {
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
  return (
    <div className={s.nav}>
      <button type="button" className={s.navLink} onClick={() => openSignIn({ reason: "save" })}>
        Save your wall
      </button>
    </div>
  );
}
