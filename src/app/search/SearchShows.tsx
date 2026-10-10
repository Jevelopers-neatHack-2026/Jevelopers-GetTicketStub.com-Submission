"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { EventData, EventType } from "@/customer/studio/types";
import { HARBOUR_GAME, NEATHACK, PALE_HOURS } from "@/customer/studio/fixtures";
import { searchEvents } from "@/customer/studio/research/client";
import { MarkLegend, SourceMark, Tag, Tags, TearLink } from "@/customer/desk/Desk";
import { LeavesMark } from "@/customer/pages/ui";
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
    <div className={`desk-surface ${styles.page}`}>
      <main className={styles.main}>
        <h1 className={styles.title}>Search for your show</h1>
        <p className={styles.lede}>Type the artist, team or event. Pick the night and we print your stub.</p>

        <form
          className={styles.searchForm}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (shown[0]) open(shown[0]);
          }}
        >
          <label htmlFor={inputId} className={`desk-label ${styles.inputLabel}`}>
            Artist, team, show or event
          </label>
          <div className={styles.line}>
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
              placeholder="The Pale Hours, Harbour FC…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </form>

        {new Set(results.map((r) => r.type)).size > 1 ? (
          <Tags label="Event type">
            {FILTERS.filter((f) => f.id === "all" || results.some((r) => r.type === f.id)).map((f) => (
              <Tag key={f.id} type="button" pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </Tag>
            ))}
          </Tags>
        ) : null}

        <p className={styles.status} role="status" aria-live="polite">
          {busy ? "Searching…" : error ? error : query.trim() && shown.length === 0 ? "No shows found yet. Try fewer words." : ""}
        </p>

        <ul className={styles.results}>
          {shown.map((ev, i) => (
            <li key={`${ev.title}-${ev.dateISO ?? i}`} className={styles.item} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <button type="button" className={styles.row} onClick={() => open(ev)}>
                <span className={styles.rowDate} aria-hidden="true">
                  {ev.dateISO ? (
                    <>
                      <span className="desk-label">{new Date(`${ev.dateISO}T12:00:00`).toLocaleString("en-GB", { month: "short" })}</span>
                      <strong className={styles.day}>{Number(ev.dateISO.slice(8, 10))}</strong>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>
                    {ev.title}
                    <SourceMark p="simulated" />
                  </span>
                  <span className={styles.rowMeta}>{[ev.subtitle, ev.venue, ev.city, formatDate(ev.dateISO)].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={styles.chev}>
                  <span className="visually-hidden">Print this stub</span>
                  <LeavesMark />
                </span>
              </button>
            </li>
          ))}
        </ul>

        {shown.length > 0 ? <MarkLegend marks={["simulated"]} /> : null}

        <TearLink type="button" className={styles.fallback} onClick={() => router.push("/")}>
          Can&apos;t find it? Paste the link instead
          <LeavesMark />
        </TearLink>
      </main>
    </div>
  );
}
