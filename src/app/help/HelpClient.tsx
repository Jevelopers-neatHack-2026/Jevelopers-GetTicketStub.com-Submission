"use client";
// Help: the desk map on top, then the questions as paper index cards that unfold one by one.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Rule } from "@/customer/desk/Desk";
import { CONTACT } from "@/customer/pages/Legal";
import { PageShell } from "@/customer/pages/ui";
import { play, haptic } from "@/customer/studio/feedback";
import DeskMap from "./DeskMap";
import { FAQ_GROUPS, type Faq } from "./faq";
import h from "./help.module.css";

function Chevron() {
  return (
    <svg className={h.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

function Card({ item, open, hidden, onToggle, panelRef }: { item: Faq; open: boolean; hidden: boolean; onToggle: (id: string) => void; panelRef: (id: string, el: HTMLElement | null) => void }) {
  const uid = useId();
  const btn = `${uid}-q`;
  const panel = `${uid}-a`;
  return (
    <li id={item.id} className={h.card} data-open={open ? "true" : undefined} hidden={hidden}>
      <h3 className={h.q}>
        <button id={btn} type="button" className={h.trigger} aria-expanded={open} aria-controls={panel} onClick={() => onToggle(item.id)}>
          <span>{item.q}</span>
          <Chevron />
        </button>
      </h3>
      <div id={panel} role="region" aria-labelledby={btn} className={h.fold} inert={!open}>
        <div className={h.foldInner}>
          <div className={h.answer} ref={(el) => panelRef(item.id, el)}>
            {item.a}
          </div>
        </div>
      </div>
    </li>
  );
}

export default function HelpClient() {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  // The answers are real components, so search reads their text from the page when you type. It can never disagree with what is shown.
  const [hits, setHits] = useState<Set<string> | null>(null);
  const panels = useRef(new Map<string, HTMLElement>());
  const searchId = useId();

  const panelRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) panels.current.set(id, el);
    else panels.current.delete(id);
  }, []);

  const search = (value: string) => {
    setQuery(value);
    const needle = value.trim().toLowerCase();
    if (!needle) return setHits(null);
    const found = new Set<string>();
    for (const g of FAQ_GROUPS)
      for (const i of g.items) if (i.q.toLowerCase().includes(needle) || (panels.current.get(i.id)?.textContent ?? "").toLowerCase().includes(needle)) found.add(i.id);
    setHits(found);
  };

  // /help#ticketmaster-links opens that card and scrolls to it.
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id || !FAQ_GROUPS.some((g) => g.items.some((i) => i.id === id))) return;
      setQuery("");
      setHits(null);
      setOpen((cur) => new Set(cur).add(id));
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // after the card has been laid out (and the filter cleared)
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" })));
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);

  const toggle = (id: string) => {
    const opening = !open.has(id);
    setOpen((cur) => {
      const next = new Set(cur);
      if (opening) next.add(id);
      else next.delete(id);
      return next;
    });
    play(opening ? "open" : "close", { emphasis: "subtle" });
    haptic(6);
  };

  const needle = query.trim();
  const matches = (i: Faq) => !hits || hits.has(i.id);
  const total = FAQ_GROUPS.reduce((n, g) => n + g.items.filter(matches).length, 0);

  return (
    <PageShell title="Help">
      <div className={h.page}>
        <header className={h.head}>
          <h1 className={h.title}>Help</h1>
          <p className={h.lede}>How a stub gets made, printed and kept. Search, or open a card.</p>
        </header>

        <DeskMap />

        <Rule kind="perf" />

        <div className={h.faq}>
          <div className={h.search}>
            <label htmlFor={searchId} className="desk-label">
              Search the questions
            </label>
            <input id={searchId} className={h.input} type="search" value={query} onChange={(e) => search(e.target.value)} placeholder="Try prices, holo or magic link" autoComplete="off" enterKeyHint="search" />
            <p className={h.count} role="status">
              {needle && total > 0 ? `${total} ${total === 1 ? "question matches" : "questions match"}.` : ""}
            </p>
          </div>

          {needle && total === 0 ? (
            <p className={h.empty}>
              No questions match. Try a different word, or email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
            </p>
          ) : null}

          {FAQ_GROUPS.map((g) => {
            const shown = g.items.filter(matches).length;
            return (
              <section key={g.id} className={h.group} aria-labelledby={`help-${g.id}`} hidden={shown === 0}>
                <h2 id={`help-${g.id}`} className="desk-label">
                  {g.title}
                </h2>
                <ul className={h.cards}>
                  {g.items.map((item) => (
                    <Card key={item.id} item={item} open={open.has(item.id)} hidden={!matches(item)} onToggle={toggle} panelRef={panelRef} />
                  ))}
                </ul>
              </section>
            );
          })}

          {needle && total === 0 ? null : (
            <p className={h.foot}>
              Still stuck? Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
            </p>
          )}
        </div>
      </div>
    </PageShell>
  );
}
