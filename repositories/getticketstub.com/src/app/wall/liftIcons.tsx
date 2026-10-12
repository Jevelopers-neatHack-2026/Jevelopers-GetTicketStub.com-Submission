// Tool icons for a lifted stub, drawn on the desk grid (24px, 1.6px stroke, round caps).
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

/** Open: a stub with its memory page opening out of it. */
export function OpenIcon() {
  return (
    <svg {...base}>
      <rect x="4" y="5" width="12" height="15" rx="1.2" />
      <path d="M13 4h7v7M20 4l-8 8" />
    </svg>
  );
}

/** Edit: a pencil on a line. */
export function EditIcon() {
  return (
    <svg {...base}>
      <path d="m15 5 4 4L9 19H5v-4L15 5Z" />
      <path d="M13 7l4 4" />
    </svg>
  );
}

/** Share: a stub passed on to the right. */
export function ShareIcon() {
  return (
    <svg {...base}>
      <rect x="3.5" y="6" width="10" height="13" rx="1.2" />
      <path d="M16 12h5m-2-2.5 2.5 2.5L19 14.5" />
    </svg>
  );
}

/** Print: a sheet coming out of a slot. */
export function PrintIcon() {
  return (
    <svg {...base}>
      <path d="M7 9V4h10v5" />
      <rect x="3.5" y="9" width="17" height="7" rx="1.6" />
      <path d="M7 14h10v6H7z" />
    </svg>
  );
}
