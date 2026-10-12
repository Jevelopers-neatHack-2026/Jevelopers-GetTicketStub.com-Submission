import { useEffect, useId, useRef, useState } from 'react';
export function Tooltip({ label, text }: { label: string; text: string }) {
  const id = useId(); const hovered = useRef(false); const button = useRef<HTMLButtonElement>(null); const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [open]);
  return <span className="td-tooltip" onMouseEnter={() => { hovered.current = true; setOpen(true); }} onMouseLeave={() => { hovered.current = false; if (document.activeElement !== button.current) setOpen(false); }} onFocus={() => setOpen(true)} onBlur={() => { if (!hovered.current) setOpen(false); }}>
    <button ref={button} type="button" aria-describedby={open ? id : undefined} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); } }}>{label}</button>
    {open && <span id={id} role="tooltip">{text}</span>}
  </span>;
}
