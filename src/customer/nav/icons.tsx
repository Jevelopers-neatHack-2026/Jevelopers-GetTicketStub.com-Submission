// Nav icons: the same 24px grid, 1.6px ink stroke and round caps as desk/icons.tsx.
import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

/** Make: a blank stub with its tear line and a plus. */
export function MakeIcon() {
  return (
    <svg {...base}>
      <rect x="5" y="3.5" width="14" height="17" rx="1.4" />
      <path d="M5 15h14" strokeDasharray="1.4 2.2" />
      <path d="M12 6.8v5M9.5 9.3h5" />
    </svg>
  );
}

/** Wall: a framed board with a pinned stub. */
export function WallIcon() {
  return (
    <svg {...base}>
      <rect x="3.5" y="4" width="17" height="16" rx="1.6" />
      <rect x="8" y="8" width="6.5" height="9" rx="0.8" transform="rotate(-5 11 12.5)" />
      <path d="M17 8.5h.01M17 12h.01" strokeWidth={2.4} />
    </svg>
  );
}

/** Cart: a tray with a stub standing in it. */
export function CartIcon() {
  return (
    <svg {...base}>
      <path d="M3.5 12.5h17l-1.6 6.2a1.4 1.4 0 0 1-1.4 1H6.5a1.4 1.4 0 0 1-1.4-1Z" />
      <rect x="8.5" y="3.5" width="7" height="9" rx="0.9" transform="rotate(-6 12 8)" />
      <path d="M10 7.2h3.6" />
    </svg>
  );
}

/** Desk map: a folded sheet with a dotted route. */
export function MapIcon() {
  return (
    <svg {...base}>
      <path d="m3.5 6.5 5-2 7 2 5-2v13l-5 2-7-2-5 2Z" />
      <path d="M8.5 4.5v13M15.5 6.5v13" strokeOpacity={0.45} />
      <path d="M6 14.5c2-1 3 1 5-.2s2.5-3 4.5-2.3" strokeDasharray="1.2 2.2" />
    </svg>
  );
}

/** Organizer: a clipboard with a column of seats. */
export function OrganizerIcon() {
  return (
    <svg {...base}>
      <rect x="5" y="4.5" width="14" height="16" rx="1.6" />
      <path d="M9.5 4.5v-1h5v1" />
      <path d="M8.5 10h.01M8.5 13.5h.01M8.5 17h.01" strokeWidth={2.2} />
      <path d="M11.5 10h4M11.5 13.5h4M11.5 17h2.5" />
    </svg>
  );
}

/** Account: a person's head and shoulders. */
export function AccountIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="8.5" r="3.4" />
      <path d="M5.5 19.5c.8-3.4 3.3-5 6.5-5s5.7 1.6 6.5 5" />
    </svg>
  );
}

/** A group's fold: points right, turns down when open. */
export function ChevronIcon() {
  return (
    <svg {...base}>
      <path d="m9.5 7 5 5-5 5" />
    </svg>
  );
}

/** The collapse handle: « folds the sidebar to a rail, » opens it. */
export function HandleIcon({ open }: { open: boolean }) {
  return (
    <svg {...base}>
      {open ? <path d="m12.5 7-5 5 5 5M18 7l-5 5 5 5" /> : <path d="m11.5 7 5 5-5 5M6 7l5 5-5 5" />}
    </svg>
  );
}

/** Style: a stub with a brush stroke across it. */
export function StyleIcon() {
  return (
    <svg {...base}>
      <rect x="5" y="3.5" width="14" height="17" rx="1.4" />
      <path d="M8.5 15.5c1.8-4.5 4.2-6.5 7-8" />
      <path d="M8.5 11.5h3" />
    </svg>
  );
}

/** Tear: a stub parting along its perforation. */
export function TearIcon() {
  return (
    <svg {...base}>
      <path d="M5.5 3.5h13v8h-13Z" />
      <path d="M5.5 14.5h13v6h-13Z" transform="rotate(3 12 17.5)" />
      <path d="M3 12.8h2.5M8 12.8h1.6M12 12.8h1.6M16 12.8h1.6" strokeDasharray="0.2 3" />
    </svg>
  );
}

/** Print: a sheet coming out of a slot. */
export function PrintIcon() {
  return (
    <svg {...base}>
      <rect x="3.5" y="11" width="17" height="7" rx="1.6" />
      <path d="M7 11V4.5h10V11" />
      <path d="M7 15.5h10v5H7Z" />
    </svg>
  );
}

/** Wallet: a card sliding into a pocket. */
export function WalletIcon() {
  return (
    <svg {...base}>
      <path d="M4 8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M7.5 6.5 16 3.8l.8 2.7" />
      <path d="M20 12h-4.5a1.8 1.8 0 0 0 0 3.6H20" />
    </svg>
  );
}

/** Gift: a stub tied with a ribbon. */
export function GiftIcon() {
  return (
    <svg {...base}>
      <rect x="4" y="9" width="16" height="11" rx="1.4" />
      <path d="M12 9v11M4 13h16" />
      <path d="M12 9C9 9 7.5 7.6 7.8 6.2 8.1 4.6 10.4 4.8 12 9Zm0 0c3 0 4.5-1.4 4.2-2.8C15.9 4.6 13.6 4.8 12 9Z" />
    </svg>
  );
}

/** Share: a slip handed across. */
export function ShareIcon() {
  return (
    <svg {...base}>
      <path d="M12 15V4M8 8l4-4 4 4" />
      <path d="M5 13v5.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V13" />
    </svg>
  );
}
