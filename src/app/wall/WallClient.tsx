"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { FitBox } from "@/customer/pages/FitBox";
import { play, haptic } from "@/customer/studio/feedback";
import { loadWall, removeStub, saveWall } from "@/customer/studio/store";
import type { Stub } from "@/customer/studio/types";
import { PageShell, CopyField, ui } from "@/customer/pages/ui";
import { copyText, absoluteUrl, encodeWall, memoryPath, formatDate, WALL_TOKEN_MAX } from "@/customer/pages/share";
import { useMounted } from "@/customer/pages/useMounted";
import s from "./wall.module.css";

type Filter = "all" | "concert" | "game" | "show" | "generic";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "concert", label: "Concerts" },
  { id: "game", label: "Games" },
  { id: "show", label: "Shows" },
  { id: "generic", label: "Other" },
];
const PUBLIC_KEY = "ticketstub.wall.public.v1";

export default function WallClient({ emailSent }: { emailSent: boolean }) {
  const mounted = useMounted();
  const [stubs, setStubs] = useState<Stub[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [banner, setBanner] = useState(emailSent);
  const [isPublic, setIsPublic] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const [loaded, setLoaded] = useState(false);
  if (mounted && !loaded) {
    setLoaded(true);
    setStubs(loadWall());
    try {
      setIsPublic(localStorage.getItem(PUBLIC_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: stubs.length, concert: 0, game: 0, show: 0, generic: 0 };
    for (const st of stubs) {
      const t = (st.event?.type ?? "generic") as Filter;
      c[t in c ? t : "generic"]++;
    }
    return c;
  }, [stubs]);
  const cities = useMemo(() => new Set(stubs.map((x) => x.event.city).filter(Boolean)).size, [stubs]);
  const visible = filter === "all" ? stubs : stubs.filter((x) => x.event.type === filter);
  const selected = stubs.find((x) => x.id === selectedId) ?? null;

  function togglePublic() {
    const next = !isPublic;
    setIsPublic(next);
    try {
      localStorage.setItem(PUBLIC_KEY, next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }

  function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    const next = [...stubs];
    const from = next.findIndex((x) => x.id === fromId);
    if (from < 0) return;
    const [moved] = next.splice(from, 1);
    const to = next.findIndex((x) => x.id === toId);
    next.splice(to < 0 ? next.length : to, 0, moved);
    setStubs(next);
    saveWall(next);
    play("pin");
    haptic([20]);
  }

  function remove(id: string) {
    removeStub(id);
    setStubs((prev) => prev.filter((x) => x.id !== id));
    setSelectedId(null);
  }

  return (
    <PageShell
      title="Your wall"
      right={
        <Link className="btn btn-quiet" href="/">
          New stub
        </Link>
      }
    >
      {banner ? (
        <div className={s.banner} role="status">
          <p>
            <strong>Check your email.</strong> We sent a link to your wall.
          </p>
          <button type="button" className={s.bannerClose} onClick={() => setBanner(false)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}

      <div className={s.layout}>
        <section className={s.boardCol} aria-labelledby="wall-h">
          <div className={s.head}>
            <h1 id="wall-h" className={ui.h1}>
              Your wall
            </h1>
            {mounted && stubs.length > 0 ? (
              <p className={`${s.stats} num`}>
                {stubs.length} {stubs.length === 1 ? "night" : "nights"} · {cities} {cities === 1 ? "city" : "cities"}
              </p>
            ) : null}
          </div>

          {mounted && stubs.length > 0 ? (
            <div className={s.chips} role="group" aria-label="Filter by event type">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label} <span className="num">{counts[f.id]}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className={s.cork}>
            {!mounted ? null : stubs.length === 0 ? (
              <div className={s.empty}>
                <div className={s.emptySlot} aria-hidden="true" />
                <p className={ui.h2}>Your wall is empty. Your first stub goes here.</p>
                <Link className="btn btn-primary" href="/">
                  Make your first stub
                </Link>
              </div>
            ) : visible.length === 0 ? (
              <p className={s.none}>No stubs of this type yet.</p>
            ) : (
              <ul className={s.grid}>
                {visible.map((st, i) => (
                  <li
                    key={st.id}
                    className={`${s.pinned} ${dragId === st.id ? s.dragging : ""}`}
                    style={{ ["--angle" as string]: `${st.wallAngle ?? 0}deg`, ["--i" as string]: i }}
                    draggable
                    onDragStart={(e) => {
                      setDragId(st.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", st.id);
                    }}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = e.dataTransfer.getData("text/plain") || dragId;
                      if (from) reorder(from, st.id);
                      setDragId(null);
                    }}
                  >
                    <span className={s.pin} aria-hidden="true" />
                    <button
                      type="button"
                      className={s.stubBtn}
                      aria-label={`Lift ${st.event.title}${st.event.dateISO ? `, ${formatDate(st.event.dateISO)}` : ""}`}
                      aria-pressed={selectedId === st.id}
                      onClick={() => {
                        setSelectedId(st.id);
                        play("flick");
                        haptic([8]);
                      }}
                    >
                      <StubView stub={st} size="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {mounted && stubs.length > 1 ? <p className={ui.muted}>Drag a stub to move it on your wall.</p> : null}

          {mounted && stubs.length > 0 ? (
            <section className={`${ui.card} ${s.publicCard}`} aria-labelledby="public-h">
              <div className={s.switchRow}>
                <div>
                  <h2 id="public-h" className={s.publicTitle}>
                    Public page
                  </h2>
                  <p className={ui.muted}>Only people with the link can see it.</p>
                </div>
                <button type="button" role="switch" aria-checked={isPublic} aria-labelledby="public-h" className={s.switch} onClick={togglePublic}>
                  <span className={s.knob} />
                </button>
              </div>
              {isPublic ? (
                <>
                  <CopyField path={`/u/${encodeWall(stubs)}`} label="Public wall link" />
                  {stubs.length > WALL_TOKEN_MAX ? <p className={ui.muted}>Your {WALL_TOKEN_MAX} newest stubs appear on the public page.</p> : null}
                </>
              ) : null}
            </section>
          ) : null}
        </section>

        <LiftPanel key={selected?.id ?? "idle"} stub={selected} onClose={() => setSelectedId(null)} onDelete={remove} hasStubs={mounted && stubs.length > 0} />
      </div>
    </PageShell>
  );
}

function LiftPanel({ stub, onClose, onDelete, hasStubs }: { stub: Stub | null; onClose: () => void; onDelete: (id: string) => void; hasStubs: boolean }) {
  const router = useRouter();
  const [flipped, setFlipped] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragX = useRef<number | null>(null);
  const dragged = useRef(false);
  const stubId = stub?.id;

  useEffect(() => {
    if (stubId && window.matchMedia("(max-width: 959px)").matches) closeRef.current?.focus();
  }, [stubId]);

  useEffect(() => {
    if (!stubId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stubId, onClose]);

  function flip() {
    setFlipped((f) => !f);
    play("flip");
    haptic([10]);
  }

  if (!stub) {
    return (
      <aside className={`${s.panel} ${s.panelIdle}`} aria-label="Lifted stub">
        <p className={ui.muted}>{hasStubs ? "Tap a stub to lift it off the wall." : "Your stubs appear here when you lift them."}</p>
      </aside>
    );
  }

  const path = memoryPath(stub);
  return (
    <aside className={`${s.panel} ${s.panelOpen}`} aria-labelledby="lift-title">
      <button type="button" className={s.scrim} aria-label="Put the stub back" tabIndex={-1} onClick={onClose} />
      <div className={s.panelInner} role="dialog" aria-labelledby="lift-title">
        <div className={s.panelHead}>
          <h2 id="lift-title" className={s.liftTitle}>
            {stub.event.title}
          </h2>
          <button ref={closeRef} type="button" className="btn btn-quiet" onClick={onClose}>
            Put back
          </button>
        </div>
        <p className={ui.muted}>{[formatDate(stub.event.dateISO), stub.event.venue, stub.event.city].filter(Boolean).join(" · ")}</p>
        <div
          className={s.lifted}
          role="button"
          tabIndex={0}
          aria-label={flipped ? "Show the front" : "Flip to the back"}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              flip();
            }
          }}
          onPointerDown={(e) => {
            dragX.current = e.clientX;
            dragged.current = false;
          }}
          onPointerMove={(e) => {
            if (dragX.current !== null && !dragged.current && Math.abs(e.clientX - dragX.current) > 48) {
              dragged.current = true;
              flip();
            }
          }}
          onPointerUp={() => {
            if (dragX.current !== null && !dragged.current) flip();
            dragX.current = null;
          }}
          onPointerCancel={() => {
            dragX.current = null;
          }}
        >
          <FitBox>
            <StubView stub={stub} size="md" tilt flipped={flipped} />
          </FitBox>
        </div>
        <p className={`${ui.muted} ${s.hint}`}>Tap or drag sideways to flip.</p>
        <div className={s.actions}>
          <Link className="btn btn-primary" href={path}>
            Open
          </Link>
          <Link className="btn" href={`/studio/${stub.id}`}>
            Edit
          </Link>
          <button
            type="button"
            className="btn"
            onClick={async () =>
              setStatus((await copyText(absoluteUrl(path))) ? "Link copied. Anyone with the link can see this stub." : "Couldn't copy the link. Open the stub and copy it from there.")
            }
          >
            Share
          </button>
          <button type="button" className="btn" onClick={() => router.push(`/checkout/${stub.id}`)}>
            Print
          </button>
          <button
            type="button"
            className={`btn btn-quiet ${s.delete}`}
            onClick={() => {
              if (confirmDelete) {
                play("tear");
                onDelete(stub.id);
              } else setConfirmDelete(true);
            }}
          >
            {confirmDelete ? "Tap again to delete" : "Delete"}
          </button>
        </div>
        <p className={ui.status} aria-live="polite">
          {status}
        </p>
      </div>
    </aside>
  );
}
