// Desk icons: 24px grid, 1.6px ink stroke, round caps. Drawn for the studio, not from a set.
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

/** Remix: a brush stroke with a spark. */
export function RemixIcon() {
  return (
    <svg {...base}>
      <path d="M4 19c2.5 0 3.5-1.2 4.2-2.8.6-1.4 1.6-2.4 3-2.2 1.5.2 2 1.7 1.3 3-.9 1.6-3.4 2.4-8.5 2Z" />
      <path d="m12.2 14 7-7.3a1.6 1.6 0 0 0-2.3-2.2L9.8 11.6" />
      <path d="M18.5 15.5v3M17 17h3" />
    </svg>
  );
}

/** Flip: a stub turning over. */
export function FlipIcon() {
  return (
    <svg {...base}>
      <rect x="7" y="4" width="10" height="16" rx="1.2" />
      <path d="M7 12h10" strokeDasharray="1.4 2.2" />
      <path d="M3.5 9.5c0-2.5 1-4 3.5-4.5M20.5 14.5c0 2.5-1 4-3.5 4.5" />
      <path d="m5.6 3.6 1.4 1.4-1.4 1.4M18.4 20.4 17 19l1.4-1.4" />
    </svg>
  );
}

/** Friends: two stubs, one behind the other. */
export function FriendsIcon() {
  return (
    <svg {...base}>
      <rect x="9" y="3.5" width="10" height="14" rx="1.2" transform="rotate(8 14 10.5)" />
      <rect x="5" y="6.5" width="10" height="14" rx="1.2" transform="rotate(-6 10 13.5)" fill="var(--desk-paper, #F4ECDD)" />
      <path d="M7.6 16.6h5" strokeDasharray="1.2 2" transform="rotate(-6 10 13.5)" />
    </svg>
  );
}

/** Ask: a speech slip with a pencil line. */
export function AskIcon() {
  return (
    <svg {...base}>
      <path d="M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3Z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...base} width={20} height={20}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

/** A registration mark: the print shop's sign for "proof, not final". */
export function RegistrationIcon() {
  return (
    <svg {...base} strokeWidth={1.4}>
      <circle cx="12" cy="12" r="5.5" />
      <path d="M12 2.5v19M2.5 12h19" />
    </svg>
  );
}

export function SoundIcon({ muted }: { muted?: boolean }) {
  return (
    <svg {...base}>
      <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3Z" />
      {muted ? <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
    </svg>
  );
}
