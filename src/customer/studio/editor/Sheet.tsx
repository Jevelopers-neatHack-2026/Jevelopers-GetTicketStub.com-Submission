"use client";
import { useEffect, useRef } from "react";
import styles from "./overlays.module.css";

interface SheetProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Visually hide the heading (it stays as the dialog's name). */
  hideTitle?: boolean;
  night?: boolean;
  wide?: boolean;
}

/** Bottom sheet on phones, centred card on desktop. Esc and the backdrop close it. */
export function Sheet({ title, open, onClose, children, hideTitle, night, wide }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement;
    const first = ref.current?.querySelector<HTMLElement>("button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={styles.sheetLayer}>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`sheet ${styles.sheetPanel} ${wide ? styles.sheetWide : ""} ${night ? "ts-night" : ""}`}
      >
        <div className={styles.grabber} aria-hidden="true" />
        <div className={styles.sheetHead}>
          <h2 className={hideTitle ? "visually-hidden" : styles.sheetTitle}>{title}</h2>
          <button type="button" className={styles.iconBtn} aria-label="Close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className={styles.sheetBody}>{children}</div>
      </div>
    </div>
  );
}
