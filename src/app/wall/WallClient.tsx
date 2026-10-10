"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { play, haptic } from "@/customer/studio/feedback";
import { loadWall, removeStub, saveWall } from "@/customer/studio/store";
import { api } from "@/customer/account/api";
import { sharePath } from "@/customer/account/share";
import { dismissSavePrompt, openSignIn, savePromptDismissed } from "@/customer/account/signin";
import { WALL_SYNCED } from "@/customer/account/sync";
import { useAccount } from "@/customer/account/useAccount";
import { MATERIALS, formatMoney, type Stub } from "@/customer/studio/types";
import { FINISHES, materialPrice } from "@/customer/pages/commerce";
import { copyText, absoluteUrl, encodeWall, memoryPath, formatDate, WALL_TOKEN_MAX } from "@/customer/pages/share";
import { useMounted } from "@/customer/pages/useMounted";
import { LeavesMark } from "@/customer/pages/ui";
import { useNavHidden } from "@/customer/nav/navState";
import { PathTrack } from "@/customer/wayfinding/PathTrack";
import { PaperButton, SandboxStrip, Stamp, Stamped, Switch, Tag, Tags, TearLink, Tool, Tools } from "@/customer/desk/Desk";
import { FlipIcon } from "@/customer/desk/icons";
import { EditIcon, OpenIcon, PrintIcon, ShareIcon } from "./liftIcons";
import { DeskPage, Pin, chrome as c } from "./chrome";
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
const LAMP_MS = 600;
const LAND_MS = 900;

/** What printing this stub costs: its material plus the finish upcharge, both from the price tables. */
function printPrice(st: Stub): number {
  const physical = st.material !== "digital";
  return materialPrice(st.material) + (physical ? (FINISHES.find((f) => f.id === st.finish)?.upchargeMinor ?? 0) : 0);
}
const materialLabel = (st: Stub) => MATERIALS.find((m) => m.id === st.material)?.label ?? "";
const finishLabel = (st: Stub) => (st.material === "digital" ? "" : (FINISHES.find((f) => f.id === st.finish)?.label ?? ""));

async function shareStub(st: Stub): Promise<string> {
  const url = absoluteUrl(await sharePath(st));
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: st.event.title, url });
      return "Shared.";
    } catch {
      /* cancelled or blocked: fall back to copying */
    }
  }
  return (await copyText(url)) ? "Link copied. Anyone with the link can see this stub." : "Couldn't copy the link. Open the stub and copy it from there.";
}

interface Lift {
  id: string;
  leaving: boolean;
  top: number;
}

export default function WallClient({ emailSent, pinnedId, liftId }: { emailSent: boolean; pinnedId?: string; liftId?: string }) {
  const router = useRouter();
  const mounted = useMounted();
  const [stubs, setStubs] = useState<Stub[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [lift, setLift] = useState<Lift | null>(null);
  const [banner, setBanner] = useState(emailSent);
  const [isPublic, setIsPublic] = useState(false);
  // the account's public page token, once the server has issued one; until then the encoded link stands in
  const [publicToken, setPublicToken] = useState<string | null>(null);
  const { status: acct } = useAccount();
  const [dragId, setDragId] = useState<string | null>(null);
  const publicRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // a sync that finished (sign-in, focus, another device) hands the merged wall back to the board
  useEffect(() => {
    const onSynced = () => setStubs(loadWall());
    window.addEventListener(WALL_SYNCED, onSynced);
    return () => window.removeEventListener(WALL_SYNCED, onSynced);
  }, []);

  // signed in with the page already public: fetch the stable token (the call is idempotent)
  useEffect(() => {
    if (acct !== "in" || !isPublic) return;
    let live = true;
    api
      .setPublic(true)
      .then((r) => live && setPublicToken(r.token))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [acct, isPublic]);

  const landing = pinnedId ? (stubs.find((x) => x.id === pinnedId) ?? null) : null;
  const landingId = landing?.id;

  // The landing: the pin presses in as the stub settles. Then the address drops its ?pinned so a reload is at rest.
  useEffect(() => {
    if (!landingId) return;
    const t = setTimeout(
      () => {
        play("pin");
        haptic([30, 30, 60]);
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : LAND_MS - 120,
    );
    // bring the board up so the landing and its next steps are in view, on a phone as on a desk
    const sc = setTimeout(() => {
      const top = (trackRef.current ?? boardRef.current)?.getBoundingClientRect().top;
      if (top !== undefined) window.scrollTo({ top: window.scrollY + top - 12, behavior: "instant" });
    }, 120);
    window.history.replaceState(null, "", "/wall");
    return () => {
      clearTimeout(t);
      clearTimeout(sc);
    };
  }, [landingId]);

  const openLift = useCallback((id: string) => {
    const r = publicRef.current?.getBoundingClientRect();
    // keep the public switch in the light: the lamp starts below it when it's on screen
    const top = r && r.bottom > 0 && r.top < window.innerHeight ? Math.ceil(r.bottom) + 12 : 16;
    setLift({ id, leaving: false, top });
    play("flick");
    haptic([8]);
  }, []);

  // /wall?lift=<id> (from "On your wall" in the editor) opens with that stub already lifted
  const [lifted, setLifted] = useState(false);
  if (loaded && !lifted) {
    setLifted(true);
    if (liftId && stubs.some((x) => x.id === liftId)) setLift({ id: liftId, leaving: false, top: 16 });
  }

  const putBack = useCallback(() => {
    setLift((cur) => {
      if (!cur || cur.leaving) return cur;
      play("pin");
      haptic([10]);
      timer.current = setTimeout(() => {
        setLift(null);
        document.querySelector<HTMLElement>(`[data-stub-id="${CSS.escape(cur.id)}"]`)?.focus();
      }, LAMP_MS);
      return { ...cur, leaving: true };
    });
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const counts = useMemo(() => {
    const n: Record<Filter, number> = { all: stubs.length, concert: 0, game: 0, show: 0, generic: 0 };
    for (const st of stubs) {
      const t = (st.event?.type ?? "generic") as Filter;
      n[t in n ? t : "generic"]++;
    }
    return n;
  }, [stubs]);
  const cities = useMemo(() => new Set(stubs.map((x) => x.event.city).filter(Boolean)).size, [stubs]);
  // a filter only shows up when it would find something, and only when there is more than one kind
  const shownFilters = FILTERS.filter((f) => f.id !== "all" && counts[f.id] > 0);
  const activeFilter = filter === "all" || counts[filter] > 0 ? filter : "all";
  const visible = (activeFilter === "all" ? stubs : stubs.filter((x) => (x.event.type ?? "generic") === activeFilter)).filter((x) => x.id !== landingId);
  const liftedStub = lift ? (stubs.find((x) => x.id === lift.id) ?? null) : null;

  function togglePublic(next: boolean) {
    setIsPublic(next);
    try {
      localStorage.setItem(PUBLIC_KEY, next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    if (acct === "in") {
      api
        .setPublic(next)
        .then((r) => setPublicToken(next ? r.token : null))
        .catch(() => {
          /* the encoded link still works; the switch tries again next time */
        });
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
    setLift(null);
  }

  return (
    <DeskPage>
      {landing ? <div className={`ts-stage desk-surface ${s.lights}`} aria-hidden="true" /> : null}

      {banner ? (
        <div className={s.banner} role="status">
          <p>
            <strong>Check your email.</strong> Your receipt is on its way.
          </p>
          <TearLink type="button" onClick={() => setBanner(false)}>
            Dismiss
          </TearLink>
        </div>
      ) : null}

      {landing ? (
        <div ref={trackRef} className={s.track}>
          <PathTrack current="wall" stubId={landing.id} fork />
        </div>
      ) : null}

      <div className={s.headRow}>
        <div className={c.head}>
          <h1 className={c.title}>Your wall</h1>
          {mounted && stubs.length > 0 ? (
            <p className={c.caption}>
              {stubs.length} {stubs.length === 1 ? "night" : "nights"}
              {cities > 0 ? ` · ${cities} ${cities === 1 ? "city" : "cities"}` : ""}
            </p>
          ) : null}
        </div>
        {mounted && stubs.length > 0 ? (
          <div ref={publicRef} className={s.publicBox}>
            <Switch checked={isPublic} onChange={togglePublic} hint="Only people with the link can see it.">
              Public page
            </Switch>
            {isPublic ? <PublicLink path={`/u/${publicToken ?? encodeWall(stubs)}`} capped={!publicToken && stubs.length > WALL_TOKEN_MAX} /> : null}
          </div>
        ) : null}
      </div>

      {mounted && shownFilters.length > 1 ? (
        <Tags label="Filter by event type">
          <Tag pressed={activeFilter === "all"} count={counts.all} onClick={() => setFilter("all")}>
            All
          </Tag>
          {shownFilters.map((f) => (
            <Tag key={f.id} pressed={activeFilter === f.id} count={counts[f.id]} onClick={() => setFilter(f.id)}>
              {f.label}
            </Tag>
          ))}
        </Tags>
      ) : null}

      <section ref={boardRef} className={`${c.cork} ${s.board}`} aria-label="Your stubs, pinned to a corkboard">
        {!mounted ? null : stubs.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptySlot} aria-hidden="true" />
            <p className={s.emptyText}>Your first stub goes here.</p>
            <Stamp type="button" onClick={() => router.push("/make")}>
              Make your first stub
              <LeavesMark />
            </Stamp>
          </div>
        ) : (
          <>
            {landing ? (
              <div className={s.feature}>
                <div className={s.landing} style={{ ["--angle" as string]: `${landing.wallAngle ?? 0}deg` } as CSSProperties}>
                  <Pin seed={landing.id} press delay={LAND_MS - 160} />
                  <StubView stub={landing} size="md" />
                </div>
                <NextSteps stub={landing} />
              </div>
            ) : null}
            {visible.length === 0 && !landing ? (
              <p className={s.none}>No stubs of this type yet.</p>
            ) : (
              <ul className={c.grid}>
                {visible.map((st, i) => (
                  <li
                    key={st.id}
                    className={`${s.pinned} ${dragId === st.id ? s.dragging : ""} ${lift?.id === st.id ? s.lifted : ""}`}
                    style={{ ["--angle" as string]: `${st.wallAngle ?? 0}deg`, ["--i" as string]: i } as CSSProperties}
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
                    <Pin seed={st.id} />
                    <button
                      type="button"
                      data-stub-id={st.id}
                      className={s.stubBtn}
                      aria-label={`Lift ${st.event.title}${st.event.dateISO ? `, ${formatDate(st.event.dateISO)}` : ""}`}
                      aria-expanded={lift?.id === st.id}
                      onClick={() => openLift(st.id)}
                    >
                      <StubView stub={st} size="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      {mounted && stubs.length > 1 ? <p className={s.hint}>Drag a stub to move it on your wall.</p> : null}

      {lift && liftedStub ? <Lamp key={liftedStub.id} stub={liftedStub} lift={lift} onPutBack={putBack} onDelete={remove} /> : null}
    </DeskPage>
  );
}

/** The public link on a paper strip. */
function PublicLink({ path, capped }: { path: string; capped: boolean }) {
  const [status, setStatus] = useState("");
  const url = absoluteUrl(path);
  return (
    <div className={s.publicLink}>
      <div className={s.copyRow}>
        <input className={s.copyInput} readOnly aria-label="Public wall link" value={url} onFocus={(e) => e.currentTarget.select()} />
        <PaperButton type="button" onClick={async () => setStatus((await copyText(url)) ? "Link copied." : "Couldn't copy. Select the link and copy it.")}>
          Copy link
        </PaperButton>
      </div>
      {capped ? <p className={s.small}>Your {WALL_TOKEN_MAX} newest stubs appear on the public page.</p> : null}
      <p className={s.small} aria-live="polite">
        {status}
      </p>
    </div>
  );
}

/** The next steps, on a paper note pinned beside the stub that just landed. */
function NextSteps({ stub }: { stub: Stub }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const { status: acct } = useAccount();
  const [notNow, setNotNow] = useState(savePromptDismissed);
  const digital = stub.material === "digital";
  const price = formatMoney(printPrice(stub));
  const detail = [materialLabel(stub), finishLabel(stub)].filter(Boolean).join(", ");
  return (
    <aside className={s.note} aria-labelledby="next-h">
      <Pin seed={`${stub.id}-note`} />
      <Stamped>Pinned</Stamped>
      <h2 id="next-h" className={s.noteTitle}>
        It&apos;s on your wall.
      </h2>
      <p className={s.noteBody}>Send it to a friend, print it, or keep it on your phone.</p>
      {acct === "out" && !notNow ? (
        <div className={s.save}>
          <p className={s.saveText}>Save to your wall. We&apos;ll email you a link, so your stubs follow you to any phone or laptop.</p>
          <div className={s.saveRow}>
            <PaperButton type="button" onClick={() => openSignIn({ reason: "save", returnTo: "/wall" })}>
              Save to your wall
            </PaperButton>
            <TearLink
              type="button"
              onClick={() => {
                dismissSavePrompt();
                setNotNow(true);
              }}
            >
              Not now
            </TearLink>
          </div>
        </div>
      ) : null}
      <div className={s.noteActions}>
        <Stamp type="button" block onClick={async () => setStatus(await shareStub(stub))}>
          Share your stub
        </Stamp>
        <PaperButton type="button" block className={s.printBtn} onClick={() => router.push(`/checkout/${stub.id}`)}>
          <span className={s.printLabel}>
            {digital ? "Get the file" : "Print it"}
            <LeavesMark />
          </span>
          <span className={s.price}>{price}</span>
        </PaperButton>
        <p className={s.small}>{detail}</p>
        <div className={s.noteLinks}>
          <TearLink type="button" onClick={() => router.push(`/wallet/${stub.id}`)}>
            Keep it in Wallet
            <LeavesMark />
          </TearLink>
          <TearLink type="button" onClick={() => router.push(`/friends/${stub.id}`)}>
            Send matching stubs to friends
            <LeavesMark />
          </TearLink>
        </div>
      </div>
      <p className={s.small} role="status">
        {status}
      </p>
      <SandboxStrip />
    </aside>
  );
}

/** A stub lifted under the lamp: the room dims to the stage, the stub tilts toward you, its tools sit on the cork. */
function Lamp({ stub, lift, onPutBack, onDelete }: { stub: Stub; lift: Lift; onPutBack: () => void; onDelete: (id: string) => void }) {
  const router = useRouter();
  useNavHidden(true);
  const [flipped, setFlipped] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const dragX = useRef<number | null>(null);
  const swiped = useRef(false);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onPutBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPutBack]);

  function flip() {
    setFlipped((f) => !f);
    play("flip");
    haptic([10]);
  }

  const path = memoryPath(stub);
  const style = { ["--lamp-top" as string]: `${lift.top}px` } as CSSProperties;
  return (
    <div ref={rootRef} tabIndex={-1} role="dialog" aria-label={`${stub.event.title}, lifted off the wall`} className={`${s.lamp} ${lift.leaving ? s.lampOff : ""}`} style={style}>
      <button type="button" className={s.scrim} aria-label="Pin it back" tabIndex={-1} onClick={onPutBack} />
      <div className={s.lampBody}>
        <div className={`ts-stage ${s.lampHead}`}>
          <h2 className={s.lampTitle}>{stub.event.title}</h2>
          <p className={s.lampMeta}>{[formatDate(stub.event.dateISO), stub.event.venue, stub.event.city].filter(Boolean).join(" · ")}</p>
        </div>
        <div
          className={s.lampStub}
          onPointerDown={(e) => {
            dragX.current = e.clientX;
            swiped.current = false;
          }}
          onPointerMove={(e) => {
            if (dragX.current !== null && !swiped.current && Math.abs(e.clientX - dragX.current) > 48) {
              swiped.current = true;
              flip();
            }
          }}
          onPointerUp={() => {
            dragX.current = null;
          }}
          onPointerCancel={() => {
            dragX.current = null;
          }}
        >
          <StubView stub={stub} size="md" tilt flipped={flipped} />
        </div>
        <div className={`${c.cork} ${c.corkFlat} ${s.tray}`}>
          <div className={s.trayPaper}>
            <Tools label="Stub actions">
              <Tool icon={<FlipIcon />} onClick={flip}>
                Flip
              </Tool>
              <Tool icon={<OpenIcon />} aria-label="Open the stub's page" onClick={() => router.push(path)}>
                <span className={s.toolGo}>
                  Page
                  <LeavesMark />
                </span>
              </Tool>
              <Tool icon={<EditIcon />} onClick={() => router.push(`/studio/${stub.id}`)}>
                <span className={s.toolGo}>
                  Edit
                  <LeavesMark />
                </span>
              </Tool>
              <Tool icon={<ShareIcon />} onClick={async () => setStatus(await shareStub(stub))}>
                Share
              </Tool>
              <Tool icon={<PrintIcon />} onClick={() => router.push(`/checkout/${stub.id}`)}>
                <span className={s.toolGo}>
                  Print
                  <LeavesMark />
                </span>
                <span className={s.toolPrice}>{formatMoney(printPrice(stub))}</span>
              </Tool>
            </Tools>
            <div className={s.trayFoot}>
              <p className={s.small} role="status">
                {status || "Tap anywhere else to pin it back."}
              </p>
              <TearLink
                type="button"
                onClick={() => {
                  if (confirmDelete) {
                    play("tear");
                    onDelete(stub.id);
                  } else setConfirmDelete(true);
                }}
              >
                {confirmDelete ? "Tap again to take it down" : "Take it down"}
              </TearLink>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
