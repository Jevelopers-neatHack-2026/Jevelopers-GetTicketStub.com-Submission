"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIsClient } from "@/customer/studio/editor/useClient";
import type { EventData } from "@/customer/studio/types";
import { HARBOUR_GAME, NEATHACK, PALE_HOURS, newStub } from "@/customer/studio/fixtures";
import { upsertStub } from "@/customer/studio/store";
import { Printing } from "@/customer/studio/research/Printing";
import styles from "./new.module.css";

const DEMOS: Record<string, EventData> = { neathack: NEATHACK, pale: PALE_HOURS, harbour: HARBOUR_GAME };

/** Search results hand their event over through sessionStorage so we don't research it twice. */
export const PICK_KEY = "ticketstub.pick.v1";

function readPicked(): EventData | undefined {
  try {
    const raw = sessionStorage.getItem(PICK_KEY);
    return raw ? (JSON.parse(raw) as EventData) : undefined;
  } catch {
    return undefined;
  }
}

export function NewStub() {
  const params = useSearchParams();
  const router = useRouter();
  const url = params.get("url")?.trim() || undefined;
  const q = params.get("q")?.trim() || undefined;
  const demo = params.get("demo") ?? undefined;
  const pick = params.get("pick") === "1";
  const [error, setError] = useState<string | null>(null);
  const client = useIsClient();
  const ready = !pick || client;
  const picked = useMemo(() => {
    if (!pick || !client) return undefined;
    const ev = readPicked();
    return ev && (!q || ev.title === q) ? ev : undefined;
  }, [pick, client, q]);
  const done = useRef(false);

  const input = useMemo(() => {
    const event = demo && DEMOS[demo] ? structuredClone(DEMOS[demo]) : picked;
    if (event) return { event };
    if (url) return { url };
    if (q) return { query: q };
    return null;
  }, [demo, picked, url, q]);

  useEffect(() => {
    if (ready && !input) router.replace("/");
  }, [ready, input, router]);

  if (error) {
    return (
      <main className={styles.errorPage}>
        <div className={styles.card} role="alert">
          <h1>We couldn&apos;t read that link.</h1>
          <p className={styles.muted}>{error}</p>
          <div className={styles.actions}>
            <Link className="btn btn-primary" href="/">
              Try another link
            </Link>
            <Link className="btn" href="/search">
              Search for your show
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!ready || !input) return <div className={`ts-night ${styles.night}`} aria-busy="true" />;

  return (
    <div className={`ts-night ${styles.night}`}>
      <Printing
        input={input}
        onDone={(event) => {
          if (done.current) return;
          done.current = true;
          const stub = newStub(event);
          upsertStub(stub);
          try {
            sessionStorage.removeItem(PICK_KEY);
          } catch {
            /* ignore */
          }
          router.replace(`/studio/${stub.id}`);
        }}
        onError={(message) => setError(message || "Try a different link, or search for the show instead.")}
      />
    </div>
  );
}
