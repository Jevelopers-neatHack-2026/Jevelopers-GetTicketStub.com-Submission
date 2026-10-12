"use client";
// The main block of a memory page, set the way the night was: a concert programme for a setlist,
// a scoreboard and a minute-by-minute for a game, a cast list, a running order.
import type { CSSProperties } from "react";
import { MarkLegend, Rule, SourceMark } from "@/customer/desk/Desk";
import type { EventData, Fact, Provenance } from "@/customer/studio/types";
import s from "./memory.module.css";

/** Fixtures carry "[SCORER]"-style gaps for facts nobody has supplied. They never print as brackets. */
export function clean(text: string): string {
  return text
    .replace(/\s*·?\s*\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceName(source: string): string {
  const m = /^\[(.+)\]$/.exec(source.trim());
  if (!m) return source;
  const t = m[1].toLowerCase().replace(/\bapi\b/, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const pad = (n: number) => String(n).padStart(2, "0");
const row = (i: number) => ({ "--i": Math.min(i, 14) }) as CSSProperties;

function Fav() {
  return (
    <span className={s.fav} role="img" aria-label="Favourite">
      <svg viewBox="0 0 16 16" aria-hidden>
        <path d="M8 2v12M2.8 5 13.2 11M13.2 5 2.8 11" />
      </svg>
    </span>
  );
}

function Head({ id, label, children }: { id: string; label: string; children?: React.ReactNode }) {
  return (
    <header className={s.secHead}>
      <h2 id={id} className={s.secTitle}>
        {label}
      </h2>
      {children}
      <Rule kind="double" />
    </header>
  );
}

/** Type-specific main block: setlist, score and moments, cast, or programme. */
export function EventContent({ event: e }: { event: EventData }) {
  if (e.type === "concert" && e.setlist?.length) {
    return (
      <section className={s.section} aria-labelledby="ec-h">
        <Head id="ec-h" label="Setlist" />
        <ol className={s.programme}>
          {e.setlist.map((song, i) => (
            <li key={`${song.title}-${i}`} className={s.progRow} data-starred={song.starred ? "" : undefined} style={row(i)}>
              <span className={s.progNo}>{pad(i + 1)}</span>
              <span className={s.progTitle}>{song.title}</span>
              {song.starred ? (
                <>
                  <span className={s.leader} aria-hidden />
                  <Fav />
                </>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    );
  }
  if (e.type === "game" && e.score) {
    const sc = e.score;
    const moments = sc.moments.map((m) => ({ ...m, text: clean(m.text) })).filter((m) => m.text);
    return (
      <section className={s.section} aria-labelledby="ec-h">
        <Head id="ec-h" label="Final score" />
        <div className={s.board}>
          <div className={s.side}>
            <span className={s.team}>{sc.home}</span>
            <span className="desk-label">Home</span>
          </div>
          <span className={s.boardScore} aria-label={`${sc.homeScore} to ${sc.awayScore}`}>
            {sc.homeScore}
            <span className={s.dash}>–</span>
            {sc.awayScore}
          </span>
          <div className={`${s.side} ${s.sideAway}`}>
            <span className={s.team}>{sc.away}</span>
            <span className="desk-label">Away</span>
          </div>
        </div>
        {moments.length ? (
          <>
            <p className={`desk-label ${s.sub}`}>Moments</p>
            <ol className={s.moments}>
              {moments.map((m, i) => (
                <li key={i} className={s.moment} data-starred={m.starred ? "" : undefined} style={row(i)}>
                  <span className={s.minute}>{m.minute}</span>
                  <span className={s.momentText}>{m.text}</span>
                  {m.starred ? <Fav /> : null}
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </section>
    );
  }
  if (e.type === "show" && e.cast?.length) {
    return (
      <section className={s.section} aria-labelledby="ec-h">
        <Head id="ec-h" label="Cast" />
        <ul className={s.programme}>
          {e.cast.map((c, i) => (
            <li key={`${c.name}-${i}`} className={s.progRow} data-starred={c.starred ? "" : undefined} style={row(i)}>
              <span className={s.progNo}>{pad(i + 1)}</span>
              <span className={s.progTitle}>{c.name}</span>
              {c.starred ? (
                <>
                  <span className={s.leader} aria-hidden />
                  <Fav />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (e.programme?.length) {
    return (
      <section className={s.section} aria-labelledby="ec-h">
        <Head id="ec-h" label="Running order" />
        <ol className={s.programme}>
          {e.programme.map((p, i) => (
            <li key={i} className={s.progRow} style={row(i)}>
              <span className={s.progNo}>{pad(i + 1)}</span>
              <span className={s.progTitle}>{p}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  return null;
}

/** Facts with their source. The printer's mark says how each was obtained; one legend explains them. */
export function Facts({ facts }: { facts: Fact[] }) {
  if (!facts?.length) return null;
  const used = Array.from(new Set(facts.map((f) => f.provenance))) as Provenance[];
  return (
    <section className={s.section} aria-labelledby="facts-h">
      <Head id="facts-h" label="Found for this night" />
      <ul className={s.facts}>
        {facts.map((f) => (
          <li key={f.id} className={s.fact} data-pending={f.provenance === "pending" ? "" : undefined}>
            <span className={s.factLabel}>{clean(f.label) || f.label}</span>
            <span className={s.factSrc}>
              {f.sourceUrl ? (
                <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className={s.srcLink}>
                  {sourceName(f.source)}
                </a>
              ) : (
                sourceName(f.source)
              )}
              <SourceMark p={f.provenance} />
            </span>
          </li>
        ))}
      </ul>
      <MarkLegend marks={used} />
    </section>
  );
}
