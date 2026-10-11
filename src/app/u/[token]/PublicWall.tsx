"use client";
import Link from "next/link";
import { useMemo } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { PageShell, FriendlyError, ui } from "@/customer/pages/ui";
import { decodeWall, formatDate, memoryPath } from "@/customer/pages/share";
import { useMounted } from "@/customer/pages/useMounted";
import s from "./public.module.css";

export default function PublicWall({ token }: { token: string }) {
  const mounted = useMounted();
  const stubs = useMemo(() => (mounted ? decodeWall(token) : []), [mounted, token]);
  const cities = new Set(stubs.map((x) => x.event.city).filter(Boolean)).size;

  if (!mounted) return <PageShell>{null}</PageShell>;
  if (stubs.length === 0) {
    return (
      <PageShell>
        <FriendlyError title="We couldn't open this wall." body="The link may be cut short. Ask for the link again, or make a wall of your own." />
      </PageShell>
    );
  }

  return (
    <PageShell
      right={
        <Link className="btn btn-primary" href="/">
          Make your own wall
        </Link>
      }
    >
      <div className={s.head}>
        <h1 className={ui.h1}>A TicketStub wall</h1>
        <p className={`${ui.muted} num`}>
          {stubs.length} {stubs.length === 1 ? "night" : "nights"} · {cities} {cities === 1 ? "city" : "cities"}
        </p>
      </div>
      <div className={s.cork}>
        <ul className={s.grid}>
          {stubs.map((st, i) => (
            <li key={`${st.id}-${i}`} className={s.pinned} style={{ ["--angle" as string]: `${st.wallAngle ?? 0}deg` }}>
              <span className={s.pin} aria-hidden="true" />
              <Link href={memoryPath(st)} className={s.stubLink} aria-label={`Open ${st.event.title}${st.event.dateISO ? `, ${formatDate(st.event.dateISO)}` : ""}`}>
                <StubView stub={st} size="sm" />
              </Link>
              <p className={s.caption}>{st.event.title}</p>
            </li>
          ))}
        </ul>
      </div>
      <p className={`${ui.muted} ${s.note}`}>Only people with the link can see this.</p>
      <div className={s.cta}>
        <p className={ui.h2}>Turn your ticket into a stub worth keeping.</p>
        <Link className="btn btn-primary" href="/">
          Make your own wall
        </Link>
      </div>
    </PageShell>
  );
}
