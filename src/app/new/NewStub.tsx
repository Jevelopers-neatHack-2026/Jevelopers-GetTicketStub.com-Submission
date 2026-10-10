"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PaperButton, Stamp } from "@/customer/desk/Desk";
import { useIsClient } from "@/customer/studio/editor/useClient";
import type { EventData } from "@/customer/studio/types";
import { DEMO_EVENTS, demoStubId } from "@/customer/studio/fixtures";
import { Printing } from "@/customer/studio/research/Printing";
import { existingStub, isDemoKey, keepStub } from "@/customer/start/make";
import styles from "./new.module.css";

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

/** The stage: paper at first, the lights go down over 600 ms (desk-surface animates the ground). */
function Stage({ children }: { children?: React.ReactNode }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDark(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={`desk-surface ${dark ? "ts-stage" : ""} ${styles.stage}`} aria-busy="true">
      {children}
    </div>
  );
}

export function NewStub() {
  const params = useSearchParams();
  const router = useRouter();
  const url = params.get("url")?.trim() || undefined;
  const q = params.get("q")?.trim() || undefined;
  const demoParam = params.get("demo");
  const demo = isDemoKey(demoParam) ? demoParam : undefined;
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
  // One id for the whole print so the preview and the finished stub match. A demo has a fixed id.
  const [freshId] = useState(() => Math.random().toString(36).slice(2, 10));
  const stubId = demo ? demoStubId(demo) : freshId;

  const input = useMemo(() => {
    const event = demo ? structuredClone(DEMO_EVENTS[demo]) : picked;
    if (event) return { event };
    if (url) return { url };
    if (q) return { query: q };
    return null;
  }, [demo, picked, url, q]);

  // Opening a demo twice reopens the stub that is already on the wall.
  const already = useMemo(() => (client && demo ? existingStub(undefined, demoStubId(demo)) : undefined), [client, demo]);
  useEffect(() => {
    if (already) router.replace(`/studio/${already.id}`);
  }, [already, router]);

  useEffect(() => {
    if (ready && !input) router.replace("/");
  }, [ready, input, router]);

  if (error) {
    return (
      <main className={`desk-surface ${styles.stage} ${styles.errorPage}`}>
        <div className={styles.card} role="alert">
          <h1 className={styles.errorTitle}>We couldn&apos;t read that link.</h1>
          <p className={styles.muted}>{error}</p>
          <div className={styles.actions}>
            <Stamp onClick={() => router.push("/")}>Try another link</Stamp>
            <PaperButton onClick={() => router.push("/search")}>Search for your show</PaperButton>
          </div>
        </div>
      </main>
    );
  }

  if (!ready || !input || already || (demo && !client)) return <Stage />;

  return (
    <Stage>
      <Printing
        input={input}
        stubId={stubId}
        onDone={(event) => {
          if (done.current) return;
          done.current = true;
          const id = keepStub(event, stubId);
          try {
            sessionStorage.removeItem(PICK_KEY);
          } catch {
            /* ignore */
          }
          router.replace(`/studio/${id}`);
        }}
        onError={(message) => setError(message || "Try a different link, or search for the show instead.")}
      />
    </Stage>
  );
}
