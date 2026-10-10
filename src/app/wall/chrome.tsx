"use client";
// Wall chrome shared by /wall and /u/[token]: the paper desk header and the pins.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import c from "./chrome.module.css";

export { c as chrome };

/** Pins never sit the same way twice: a tilt from -16 to 16 degrees, set by the stub's id. */
export function pinTilt(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 33) - 16) | 0;
}

export function Pin({ seed, press, delay }: { seed: string; press?: boolean; delay?: number }) {
  const style = { ["--tilt" as string]: `${pinTilt(seed)}deg`, ["--pin-delay" as string]: `${delay ?? 0}ms` } as CSSProperties;
  return (
    <span className={`${c.pin} ${press ? c.pinPress : ""}`} style={style} aria-hidden="true">
      <span className={c.pinHead} />
    </span>
  );
}

/** Paper desk page: header with the wordmark, then the content. */
export function DeskPage({ right, children }: { right?: ReactNode; children: ReactNode }) {
  return (
    <div className={`desk-surface ${c.page}`}>
      <header className={c.top}>
        <Link className={c.home} href="/" aria-label="TicketStub home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wordmark.svg" alt="TicketStub" />
        </Link>
        {right ? <div className={c.topRight}>{right}</div> : null}
      </header>
      <main className={c.main}>{children}</main>
    </div>
  );
}
