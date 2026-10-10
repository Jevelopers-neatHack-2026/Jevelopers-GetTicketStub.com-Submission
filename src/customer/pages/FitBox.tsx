"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Scales fixed-width content (a StubView) down to fit its container, never up. */
export function FitBox({ children, className }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; h?: number }>({ scale: 1 });

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const cs = getComputedStyle(o);
      const avail = o.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const w = i.offsetWidth;
      const h = i.offsetHeight;
      const scale = w > 0 && avail > 0 ? Math.min(1, avail / w) : 1;
      setFit((prev) => (prev.scale === scale && prev.h === h * scale ? prev : { scale, h: h * scale }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outer} className={className} style={{ width: "100%", display: "flex", justifyContent: "center", height: fit.scale < 1 ? fit.h : undefined }}>
      <div ref={inner} style={{ width: "max-content", flex: "none", transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined, transformOrigin: "top center" }}>
        {children}
      </div>
    </div>
  );
}
