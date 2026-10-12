"use client";
// Where you are, from the same route tree as the sidebar: "Wall › The Pale Hours › Print". Quiet small caps;
// the last crumb is inked and not a link. On the phone the middle crumbs fold into a "…". Renders nothing on a
// top-level page, and nothing on a route the tree doesn't know (the caller keeps its own back link there).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { play } from "@/customer/studio/feedback";
import { buildTree, chainOf, useLocation } from "./routes";
import b from "./Breadcrumbs.module.css";

/** True when the tree knows this route as a child, so the breadcrumbs are showing. */
export function useCrumbs() {
  const path = usePathname() ?? "/";
  const { keys, stubs } = useLocation(path);
  return useMemo(() => chainOf(buildTree({ keys, stubs, cartCount: 0, path }), keys), [keys, stubs, path]);
}

export function Breadcrumbs({ className }: { className?: string }) {
  const chain = useCrumbs();
  if (chain.length < 2) return null;
  const last = chain.length - 1;
  return (
    <nav aria-label="Breadcrumb" className={`${b.crumbs} ${className ?? ""}`}>
      <ol className={b.list}>
        {chain.map((n, i) => {
          // share rows have no href until the sidebar resolves one; they are only ever the last crumb
          const href = n.href;
          const isLast = i === last;
          return (
            <li key={`${n.key}-${i}`} className={b.crumb} data-mid={i > 0 && i < last ? "true" : undefined} data-last={isLast ? "true" : undefined}>
              {i > 0 ? <span className={b.sep} aria-hidden>›</span> : null}
              {isLast && last > 1 ? (
                <span className={b.fold} aria-hidden>
                  …<span className={b.sep}>›</span>
                </span>
              ) : null}
              {isLast || !href ? (
                <span className={b.text} aria-current={isLast ? "page" : undefined}>
                  {n.label}
                </span>
              ) : (
                <Link href={href} className={b.text} onClick={() => play("tap", { emphasis: "subtle" })}>
                  {n.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
