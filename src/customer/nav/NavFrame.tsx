"use client";
// One frame for every screen: a paper sidebar on the desktop, a punched-tab bar on the phone, and the
// same sidebar sliding in from the left as the phone's drawer. It stays out of the landing page, the
// parts board and the printing stage.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { CloseIcon, SoundIcon } from "@/customer/desk/icons";
import { loadCart } from "@/customer/pages/commerce";
import { play, useMuted } from "@/customer/studio/feedback";
import { CartIcon, HandleIcon, MakeIcon, MapIcon, MoreIcon, OrganizerIcon, WallIcon } from "./icons";
import { useNavOpen } from "./navState";
import f from "./NavFrame.module.css";

interface Place {
  id: string;
  href: string;
  label: string;
  Icon: ComponentType;
  /** Routes that count as being at this place. */
  at: (path: string) => boolean;
}

const PLACES: Place[] = [
  { id: "make", href: "/", label: "Make", Icon: MakeIcon, at: (p) => p.startsWith("/studio") },
  { id: "wall", href: "/wall", label: "Wall", Icon: WallIcon, at: (p) => p === "/wall" },
  { id: "cart", href: "/cart", label: "Cart", Icon: CartIcon, at: (p) => p.startsWith("/cart") || p.startsWith("/checkout") },
  { id: "map", href: "/map", label: "Desk map", Icon: MapIcon, at: (p) => p === "/map" },
  { id: "organizer", href: "/organizer", label: "Organizer", Icon: OrganizerIcon, at: (p) => p.startsWith("/organizer") },
];
const MAIN = PLACES.slice(0, 3);
const MORE = PLACES.slice(3);

const HIDDEN = ["/", "/parts", "/new"];

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

/** Cart count: re-read on every render (route changes re-render the frame) and on the storage event. */
function useCartCount(): number {
  return useSyncExternalStore(subscribeStorage, () => loadCart().length, () => 0);
}

export function NavFrame({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  const show = !HIDDEN.includes(path);
  const inStudio = path.startsWith("/studio");
  const [open, toggleOpen] = useNavOpen(inStudio);
  const [muted, setMuted] = useMuted();
  const count = useCartCount();
  // The drawer belongs to the route it was opened on, so any navigation closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawer = drawerPath === path;
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const closeDrawer = () => {
    if (!drawer) return;
    setDrawerPath(null);
    play("close", { emphasis: "subtle" });
  };

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerPath(null);
        play("close", { emphasis: "subtle" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  if (!show) {
    return (
      <div className={f.frame} data-nav="off">
        {children}
      </div>
    );
  }

  const current = PLACES.findIndex((p) => p.at(path));
  const select = (i: number) => play("select", { emphasis: "subtle", direction: i >= current ? "forward" : "back" });
  const barIndex = current < 0 ? -1 : current < MAIN.length ? current : MAIN.length;

  const itemLink = (p: Place, i: number) => (
    <Link
      key={p.id}
      href={p.href}
      className={f.item}
      aria-current={i === current ? "page" : undefined}
      title={open ? undefined : p.label}
      onClick={() => select(i)}
    >
      <span className={f.icon}>
        <p.Icon />
        {p.id === "cart" && count > 0 ? <span className={f.dot} aria-hidden /> : null}
      </span>
      <span className={f.label}>{p.label}</span>
      {p.id === "cart" && count > 0 ? (
        <span className={f.count} aria-label={`${count} in your cart`}>
          {count}
        </span>
      ) : null}
    </Link>
  );

  return (
    <div className={f.frame} data-nav="on" data-open={open} data-bar={inStudio ? "off" : "on"} data-drawer={drawer}>
      <button type="button" className={f.scrim} aria-label="Close menu" tabIndex={-1} onClick={closeDrawer} />
      <aside
        className={f.side}
        aria-label="TicketStub"
        onPointerDown={(e) => {
          swipe.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const s = swipe.current;
          if (!s || !drawer) return;
          if (e.clientX - s.x < -56 && Math.abs(e.clientY - s.y) < 40) {
            swipe.current = null;
            closeDrawer();
          }
        }}
        onPointerUp={() => (swipe.current = null)}
        onPointerCancel={() => (swipe.current = null)}
      >
        <div className={f.head}>
          <Link href="/" className={f.mark} aria-label="TicketStub home" onClick={() => select(0)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={f.wordmark} src="/brand/wordmark.svg" alt="" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={f.stampMark} src="/brand/ts-stamp.svg" alt="" />
          </Link>
          <button
            type="button"
            className={f.handle}
            aria-label={open ? "Fold the sidebar to a rail" : "Open the sidebar"}
            title={open ? "Fold to a rail" : "Open the sidebar"}
            aria-expanded={open}
            onClick={() => {
              play("toggle", { emphasis: "subtle", direction: open ? "back" : "forward" });
              toggleOpen();
            }}
          >
            <HandleIcon open={open} />
          </button>
          <button type="button" className={f.close} aria-label="Close menu" onClick={closeDrawer}>
            <CloseIcon />
          </button>
        </div>
        <nav className={f.list} aria-label="Places">
          {MAIN.map((p, i) => itemLink(p, i))}
          <hr className={f.rule} />
          {MORE.map((p, i) => itemLink(p, i + MAIN.length))}
        </nav>
        <div className={f.foot}>
          <button
            type="button"
            className={f.item}
            aria-pressed={muted}
            title={open ? undefined : muted ? "Sound is off" : "Sound is on"}
            onClick={() => {
              setMuted(!muted);
              if (muted) play("toggle", { emphasis: "subtle", direction: "forward" });
            }}
          >
            <span className={f.icon}>
              <SoundIcon muted={muted} />
            </span>
            <span className={f.label}>{muted ? "Sound off" : "Sound on"}</span>
          </button>
        </div>
      </aside>

      <div className={f.content}>{children}</div>

      <nav className={f.bar} aria-label="Places">
        <div className={f.tray}>
          <span className={f.thumb} style={{ transform: `translateX(${Math.max(barIndex, 0) * 100}%)`, opacity: barIndex < 0 ? 0 : 1 }} aria-hidden />
          {MAIN.map((p, i) => (
            <Link key={p.id} href={p.href} className={f.tab} aria-current={i === current ? "page" : undefined} onClick={() => select(i)}>
              <span className={f.icon}>
                <p.Icon />
                {p.id === "cart" && count > 0 ? <span className={f.badge}>{count}</span> : null}
              </span>
              <span>{p.label}</span>
            </Link>
          ))}
          <button
            type="button"
            className={f.tab}
            aria-current={barIndex === MAIN.length ? "page" : undefined}
            aria-haspopup="dialog"
            aria-expanded={drawer}
            onClick={() => {
              setDrawerPath(path);
              play("open", { emphasis: "subtle" });
            }}
          >
            <span className={f.icon}>
              <MoreIcon />
            </span>
            <span>More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
