"use client";
import Link from "next/link";
import { useMemo, type CSSProperties } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { decodeWall, formatDate, memoryPath } from "@/customer/pages/share";
import { useMounted } from "@/customer/pages/useMounted";
import { StampLink } from "@/customer/pages/ui";
import { DeskPage, Pin, chrome as c } from "@/app/wall/chrome";
import s from "./public.module.css";

export default function PublicWall({ token }: { token: string }) {
  const mounted = useMounted();
  const stubs = useMemo(() => (mounted ? decodeWall(token) : []), [mounted, token]);
  const cities = new Set(stubs.map((x) => x.event.city).filter(Boolean)).size;

  if (!mounted) return <DeskPage>{null}</DeskPage>;
  if (stubs.length === 0) {
    return (
      <DeskPage>
        <div className={s.lost}>
          <h1 className={c.title}>We couldn&apos;t open this wall.</h1>
          <p className={s.lede}>The link may be cut short. Ask for the link again, or make a wall of your own.</p>
          <StampLink href="/">Make your own wall</StampLink>
        </div>
      </DeskPage>
    );
  }

  return (
    <DeskPage>
      <div className={c.head}>
        <h1 className={c.title}>A TicketStub wall</h1>
        <p className={c.caption}>
          {stubs.length} {stubs.length === 1 ? "night" : "nights"}
          {cities > 0 ? ` · ${cities} ${cities === 1 ? "city" : "cities"}` : ""}
        </p>
      </div>
      <section className={c.cork} aria-label="Stubs pinned to a corkboard">
        <ul className={c.grid}>
          {stubs.map((st, i) => (
            <li key={`${st.id}-${i}`} className={s.pinned} style={{ ["--angle" as string]: `${st.wallAngle ?? 0}deg`, ["--i" as string]: i } as CSSProperties}>
              <Pin seed={`${st.id}-${i}`} />
              <Link href={memoryPath(st)} className={s.stubLink} aria-label={`Open ${st.event.title}${st.event.dateISO ? `, ${formatDate(st.event.dateISO)}` : ""}`}>
                <StubView stub={st} size="sm" />
              </Link>
              <p className={s.label}>{st.event.title}</p>
            </li>
          ))}
        </ul>
      </section>
      <p className={s.note}>Only people with the link can see this.</p>
      <div className={s.cta}>
        <p className={s.ctaText}>Turn your ticket into a stub worth keeping.</p>
        <StampLink href="/">Make your own wall</StampLink>
      </div>
    </DeskPage>
  );
}
