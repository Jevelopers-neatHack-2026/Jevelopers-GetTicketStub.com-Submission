"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { EventData, EventType } from "@/customer/studio/types";
import { HARBOUR_GAME, NEATHACK, PALE_HOURS } from "@/customer/studio/fixtures";
import { searchEvents } from "@/customer/studio/research/client";
import { MuteToggle } from "@/customer/studio/editor/MuteToggle";
import { PICK_KEY } from "../new/NewStub";
import styles from "./search.module.css";

const FILTERS: { id: EventType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "concert", label: "Concerts" },
  { id: "game", label: "Games" },
  { id: "show", label: "Shows" },
  { id: "generic", label: "Everything else" },
];

const DEMO_BY_TITLE: Record<string, string> = {
  [NEATHACK.title]: "neathack",
  [PALE_HOURS.title]: "pale",
  [HARBOUR_GAME.title]: "harbour",
};

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

export function SearchShows() {
  const params = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [filter, setFilter] = useState<EventType | "all">("all");
  const [results, setResults] = useState<EventData[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    let live = true;
    const q = query.trim();
    const t = window.setTimeout(
      async () => {
        setBusy(true);
        setError(null);
        try {
          const found = await searchEvents(q);
          if (live) setResults(found);
        } catch (e) {
          if (live) {
            setResults([]);
            if (q) setError(e instanceof Error ? e.message : "Search isn't working right now. Paste the link instead.");
          }
        } finally {
          if (live) setBusy(false);
        }
      },
      q ? 250 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [query]);

  const shown = filter === "all" ? results : results.filter((r) => r.type === filter);

  const open = (ev: EventData) => {
    const demo = DEMO_BY_TITLE[ev.title];
    if (demo) {
      router.push(`/new?demo=${demo}`);
      return;
    }
    try {
      sessionStorage.setItem(PICK_KEY, JSON.stringify(ev));
      router.push(`/new?q=${encodeURIComponent(ev.title)}&pick=1`);
    } catch {
      router.push(`/new?q=${encodeURIComponent(ev.title)}`);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back} aria-label="Back to home">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <h1 className={styles.title}>Search for your show</h1>
        <MuteToggle />
      </header>

      <main className={styles.main}>
        <form
          className={styles.searchForm}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (shown[0]) open(shown[0]);
          }}
        >
          <label htmlFor={inputId} className="visually-hidden">
            Artist, team, show or event
          </label>
          <svg className={styles.searchIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            id={inputId}
            className={styles.input}
            type="search"
            autoFocus
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Artist, team, show or event"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>

        <div className={styles.filters} role="group" aria-label="Event type">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        <p className={styles.status} role="status" aria-live="polite">
          {busy ? "Searching…" : error ? error : query.trim() && shown.length === 0 ? "No shows found yet. Try fewer words." : ""}
        </p>

        <ul className={styles.results}>
          {shown.map((ev, i) => (
            <li key={`${ev.title}-${ev.dateISO ?? i}`}>
              <button type="button" className={styles.row} onClick={() => open(ev)}>
                <span className={styles.rowDate} aria-hidden="true">
                  {ev.dateISO ? (
                    <>
                      <span>{new Date(`${ev.dateISO}T12:00:00`).toLocaleString("en-GB", { month: "short" })}</span>
                      <strong className="num">{Number(ev.dateISO.slice(8, 10))}</strong>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{ev.title}</span>
                  <span className={styles.rowMeta}>{[ev.subtitle, ev.venue, ev.city, formatDate(ev.dateISO)].filter(Boolean).join(" · ")}</span>
                </span>
                <span aria-hidden="true" className={styles.chev}>
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>

        <Link href="/" className={styles.fallback}>
          Can&apos;t find it? Paste the link instead
        </Link>
      </main>
    </div>
  );
}
