"use client";
// Privacy and terms as desk pages: one headline lockup, short sections set as labelled paragraphs.
import Link from "next/link";
import type { ReactNode } from "react";
import { Rule } from "@/customer/desk/Desk";
import { PageShell } from "./ui";
import s from "./legal.module.css";

export const CONTACT = "hello@getticketstub.com";

export interface LegalSection {
  title: string;
  body: ReactNode;
}

export function LegalPage({ kicker, title, lede, updated, sections, other }: { kicker: string; title: string; lede: string; updated: string; sections: LegalSection[]; other: { href: string; label: string } }) {
  return (
    <PageShell title={title} narrow>
      <article className={s.wrap}>
        <header className={s.head}>
          <p className="desk-label">{kicker}</p>
          <h1 className={s.title}>{title}</h1>
          <p className={s.lede}>{lede}</p>
        </header>
        {sections.map((sec, i) => (
          <section key={sec.title} className={s.section} aria-labelledby={`legal-${i}`}>
            <h2 id={`legal-${i}`} className="desk-label">
              {sec.title}
            </h2>
            <div className={s.body}>{sec.body}</div>
          </section>
        ))}
        <Rule kind="perf" />
        <p className={s.foot}>
          <span className={s.num}>Updated {updated}.</span> Questions? Write to{" "}
          <a className={s.plain} href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          . <Link className={s.plain} href={other.href}>{other.label}</Link>
        </p>
      </article>
    </PageShell>
  );
}
