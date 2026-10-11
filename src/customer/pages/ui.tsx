"use client";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { SANDBOX_LABEL } from "./commerce";
import { absoluteUrl, copyText } from "./share";
import s from "./ui.module.css";

export { s as ui };

export function PageShell({
  title,
  back,
  right,
  narrow,
  children,
  className,
}: {
  title?: string;
  back?: { href: string; label: string };
  right?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${s.shell} ${className ?? ""}`}>
      <header className={s.top}>
        {back ? (
          <Link className={s.back} href={back.href}>
            <span aria-hidden="true">‹</span> {back.label}
          </Link>
        ) : (
          <Link className={s.home} href="/" aria-label="TicketStub home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wordmark.svg" alt="TicketStub" />
          </Link>
        )}
        {title ? <span className={s.topTitle}>{title}</span> : null}
        {right ? <div className={s.topRight}>{right}</div> : null}
      </header>
      <main className={`${s.main} ${narrow ? s.narrow : ""}`}>{children}</main>
    </div>
  );
}

export function SandboxBadge({ text = SANDBOX_LABEL }: { text?: string }) {
  return (
    <span className={s.sandbox} role="note">
      {text}
    </span>
  );
}

/** Read-only link with a copy button. `path` is site-relative; the absolute URL is shown and copied. */
export function CopyField({ path, label = "Link" }: { path: string; label?: string }) {
  const id = useId();
  const [status, setStatus] = useState("");
  const url = absoluteUrl(path);
  return (
    <div className={s.stack} style={{ gap: 4 }}>
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <div className={s.copy}>
        <input id={id} className={s.copyInput} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => setStatus((await copyText(url)) ? "Link copied." : "Couldn't copy. Select the link and copy it.")}
        >
          Copy link
        </button>
      </div>
      <p className={s.status} aria-live="polite">
        {status}
      </p>
    </div>
  );
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** QR-like placeholder (no QR library): deterministic modules plus three finder squares. Not scannable. */
export function QrPlaceholder({ value, caption, size = 25 }: { value: string; caption?: string; size?: number }) {
  let seed = hash(value) || 1;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
  const cells: ReactNode[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = rand();
      if (!inFinder(x, y) && r > 0.52) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />);
    }
  const finder = (x: number, y: number) => (
    <g key={`f${x}${y}`}>
      <rect x={x} y={y} width={7} height={7} />
      <rect x={x + 1} y={y + 1} width={5} height={5} fill="#fff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} />
    </g>
  );
  return (
    <figure className={s.qrWrap} style={{ margin: 0 }}>
      <svg className={s.qr} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={caption ?? "QR code placeholder"} shapeRendering="crispEdges" fill="#17140F">
        {cells}
        {finder(0, 0)}
        {finder(size - 7, 0)}
        {finder(0, size - 7)}
      </svg>
      {caption ? <figcaption className={s.muted}>{caption}</figcaption> : null}
    </figure>
  );
}

export function FriendlyError({ title, body }: { title: string; body: string }) {
  return (
    <div className={s.error}>
      <h1 className={s.h2}>{title}</h1>
      <p className={s.muted}>{body}</p>
      <Link className="btn btn-primary" href="/">
        Make your own stub
      </Link>
    </div>
  );
}
