"use client";
// Whether the signed-in account is staff, for the sidebar's Admin row only. Hiding the row is cosmetic: /admin
// answers a 404 to anyone the server doesn't know as staff, whatever this says.
import { useEffect, useState } from "react";
import { useAccount } from "@/customer/account/useAccount";

const cache = new Map<string, boolean>();

export function useStaff(): boolean {
  const { status, account } = useAccount();
  const key = account?.id ?? "";
  const [staff, setStaff] = useState<{ key: string; value: boolean } | null>(null);
  useEffect(() => {
    if (status !== "in" || cache.has(key)) return;
    let live = true;
    fetch("/api/context", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { context?: { role?: string; capabilities?: string[] } } | null) => {
        const ctx = body?.context;
        const value = ctx?.role === "staff" && !!ctx.capabilities?.includes("admin.view");
        cache.set(key, value);
        if (live) setStaff({ key, value });
      })
      .catch(() => {
        // a failed lookup shows no row; nothing else depends on it
        cache.set(key, false);
      });
    return () => {
      live = false;
    };
  }, [status, key]);
  if (status !== "in") return false;
  return cache.get(key) ?? (staff?.key === key ? staff.value : false);
}
