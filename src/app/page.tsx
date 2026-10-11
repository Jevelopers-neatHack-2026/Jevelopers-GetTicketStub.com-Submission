"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import type { Stub } from "@/customer/studio/types";
import { loadWall } from "@/customer/studio/store";
import { StubView } from "@/customer/studio/stub/StubView";
import { MuteToggle } from "@/customer/studio/editor/MuteToggle";
import { useIsClient } from "@/customer/studio/editor/useClient";
import styles from "./page.module.css";

const DEMOS = [
  { id: "neathack", label: "neatHack 2026" },
  { id: "pale", label: "The Pale Hours" },
  { id: "harbour", label: "Harbour FC v Northgate" },
];

function looksLikeLink(text: string): boolean {
  return /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(text);
}

export default function Home() {
  const router = useRouter();
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const client = useIsClient();
  const wall = useMemo<Stub[]>(() => (client ? loadWall() : []), [client]);
  const canPaste = client && !!navigator.clipboard?.readText;

  const go = (value: string) => {
    const v = value.trim();
    if (!v) {
      setMessage("Paste your event link first.");
      inputRef.current?.focus();
      return;
    }
    if (looksLikeLink(v)) {
      const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
      router.push(`/new?url=${encodeURIComponent(url)}`);
    } else {
      router.push(`/new?q=${encodeURIComponent(v)}`);
    }
  };

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setMessage("Your clipboard is empty. Copy the link from your ticket email or app.");
        return;
      }
      setLink(text);
      setMessage(null);
    } catch {
      setMessage("We couldn't read your clipboard. Press and hold the field to paste.");
      inputRef.current?.focus();
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="TicketStub home">
          <picture>
            <source srcSet="/brand/wordmark-cream.svg" media="(prefers-color-scheme: dark)" />
            <img src="/brand/wordmark.svg" alt="TicketStub" height={28} className={styles.wordmark} />
          </picture>
        </Link>
        <nav className={styles.nav} aria-label="Main">
          <Link href="/wall" className={styles.navLink}>
            Your wall
          </Link>
          <MuteToggle />
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="home-title">
          <h1 id="home-title" className={styles.headline}>
            Turn your ticket into a stub worth keeping.
          </h1>
          <p className={styles.lede}>Paste the link from your ticket email or app. We&apos;ll find the night and print your stub.</p>

          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              go(link);
            }}
          >
            <label htmlFor={inputId} className={styles.label}>
              Paste your event link
            </label>
            <div className={styles.inputRow}>
              <input
                ref={inputRef}
                id={inputId}
                className={styles.input}
                type="text"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="go"
                placeholder="ticketmaster.com/event/…"
                value={link}
                aria-describedby={message ? hintId : undefined}
                onChange={(e) => {
                  setLink(e.target.value);
                  if (message) setMessage(null);
                }}
              />
              {canPaste && (
                <button type="button" className={`btn btn-quiet ${styles.pasteBtn}`} onClick={paste}>
                  Paste
                </button>
              )}
            </div>
            <p id={hintId} className={styles.message} role="status" aria-live="polite">
              {message ?? ""}
            </p>
            <button type="submit" className={`btn btn-primary btn-block ${styles.cta}`}>
              Make my stub
            </button>
          </form>
        </section>

        <section className={styles.noLink} aria-labelledby="no-link-title">
          <h2 id="no-link-title" className={styles.sectionTitle}>
            No link?
          </h2>
          <Link href="/search" className={`btn ${styles.searchBtn}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            Search for your show
          </Link>
          <div className={styles.dropZone} aria-disabled="true">
            <span>Or drop a screenshot, email or PDF</span>
            <span className="provenance">Coming soon</span>
          </div>
        </section>

        <section className={styles.demos} aria-label="Try a demo stub">
          <span className={styles.demoLabel}>Try:</span>
          {DEMOS.map((d) => (
            <Link key={d.id} href={`/new?demo=${d.id}`} className={`chip ${styles.demoChip}`}>
              {d.label}
            </Link>
          ))}
        </section>

        {wall.length > 0 && (
          <section className={styles.wallPeek} aria-labelledby="wall-title">
            <div className={styles.wallHead}>
              <h2 id="wall-title" className={styles.sectionTitle}>
                Your wall
              </h2>
              <Link href="/wall" className={styles.navLink}>
                See all {wall.length}
              </Link>
            </div>
            <Link href="/wall" className={styles.peekRow} aria-label={`Open your wall, ${wall.length} stubs`}>
              {wall.slice(0, 4).map((s) => (
                <span key={s.id} className={styles.peekItem} style={{ transform: `rotate(${s.wallAngle}deg)` }} aria-hidden="true">
                  <StubView stub={s} size="sm" />
                </span>
              ))}
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
