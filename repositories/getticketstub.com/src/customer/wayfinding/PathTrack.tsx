"use client";
// The path strip: Paste, Style, Tear, Wall, then the fork into Print or Keep. Quiet small caps on a
// perforated line. Steps you have done are punched through, the current one is inked. Done steps
// that have a place to go back to are links; the rest are plain text. It is a map, not a stepper.
import Link from "next/link";
import { Fragment } from "react";
import { LeavesMark } from "@/customer/pages/ui";
import { play } from "@/customer/studio/feedback";
import styles from "./PathTrack.module.css";

export type PathStep = "paste" | "style" | "tear" | "wall";

const STEPS: { id: PathStep; label: string }[] = [
  { id: "paste", label: "Paste" },
  { id: "style", label: "Style" },
  { id: "tear", label: "Tear" },
  { id: "wall", label: "Wall" },
];

interface Props {
  current: PathStep;
  /** Lets done steps link back (Style reopens the editor) and the fork point at this stub. */
  stubId?: string;
  /** Show the Print or Keep fork after the wall. */
  fork?: boolean;
  className?: string;
}

export function PathTrack({ current, stubId, fork, className }: Props) {
  const at = STEPS.findIndex((s) => s.id === current);
  const back = (id: PathStep): string | undefined => {
    if (id === "style" && stubId) return `/studio/${encodeURIComponent(stubId)}`;
    if (id === "wall") return "/wall";
    return undefined;
  };
  return (
    <nav className={`${styles.track} ${className ?? ""}`} aria-label="Where you are on the path">
      <ol className={styles.steps}>
        {STEPS.map((step, i) => {
          const state = i < at ? "done" : i === at ? "current" : "next";
          const href = state === "done" ? back(step.id) : undefined;
          const body = (
            <>
              <span className={styles.punch} aria-hidden="true" />
              <span className={styles.name}>{step.label}</span>
            </>
          );
          return (
            <Fragment key={step.id}>
              {i > 0 && <li className={styles.perf} data-done={i <= at} aria-hidden="true" />}
              <li className={styles.step} data-state={state} aria-current={state === "current" ? "step" : undefined}>
                {href ? (
                  <Link className={styles.stepLink} href={href} onClick={() => play("tap", { emphasis: "subtle" })}>
                    {body}
                  </Link>
                ) : (
                  <span className={styles.stepLink}>{body}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
      {fork && stubId ? (
        <p className={styles.fork}>
          <span className={styles.forkLead}>Then</span>
          <Link className={styles.forkLink} href={`/checkout/${encodeURIComponent(stubId)}`} onClick={() => play("tap", { emphasis: "subtle" })}>
            Print it
            <LeavesMark />
          </Link>
          <span className={styles.forkOr} aria-hidden="true">
            or
          </span>
          <Link className={styles.forkLink} href={`/wallet/${encodeURIComponent(stubId)}`} onClick={() => play("tap", { emphasis: "subtle" })}>
            Keep it in Wallet
            <LeavesMark />
          </Link>
        </p>
      ) : null}
    </nav>
  );
}
