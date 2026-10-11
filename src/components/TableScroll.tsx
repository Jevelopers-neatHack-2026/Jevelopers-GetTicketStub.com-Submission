import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
/** Native buttons keep overflowing read-only tables operable without a custom tab stop. */
export function TableScroll({ caption, children }: { caption: string; children: ReactNode }) {
  const id = useId(); const viewport = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ overflow: false, start: true, end: true, width: 0 });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => {
      const style = getComputedStyle(element);
      const next = { overflow: element.scrollWidth > element.clientWidth + 1, start: element.scrollLeft <= 1, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1, width: element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0) };
      setPosition((previous) => previous.overflow === next.overflow && previous.start === next.start && previous.end === next.end && previous.width === next.width ? previous : next);
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update); observer?.observe(element);
    const table = element.querySelector('table'); if (table) observer?.observe(table);
    element.addEventListener('scroll', update); window.addEventListener('resize', update);
    const frame = window.setTimeout(update, 0);
    return () => { observer?.disconnect(); element.removeEventListener('scroll', update); window.removeEventListener('resize', update); window.clearTimeout(frame); };
  }, [children]);
  function move(direction: 'left' | 'right' | 'start' | 'end') {
    const element = viewport.current; if (!element) return;
    const left = direction === 'start' ? 0 : direction === 'end' ? element.scrollWidth : element.scrollLeft + (direction === 'left' ? -1 : 1) * element.clientWidth * .75;
    element.scrollTo({ left, behavior: 'auto' });
  }
  function key(event: KeyboardEvent<HTMLButtonElement>) {
    const direction = ({ ArrowLeft: 'left', ArrowRight: 'right', Home: 'start', End: 'end' } as const)[event.key as 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'];
    if (direction) { event.preventDefault(); move(direction); }
  }
  return <div className="td-table-frame"><div ref={viewport} id={id} className="td-table-scroll" role="region" aria-label={caption}><div className="td-table-content">
    {position.overflow && <div className="td-table-tools" style={{ width: position.width }}><p>Table scrolls horizontally. Use the scroll buttons or horizontal scrollbar to view every column.</p><div className="td-controls">
      <button type="button" aria-controls={id} aria-label={`Scroll ${caption} left`} aria-disabled={position.start} onClick={() => { if (!position.start) move('left'); }} onKeyDown={key}>Scroll left</button>
      <button type="button" aria-controls={id} aria-label={`Scroll ${caption} right`} aria-disabled={position.end} onClick={() => { if (!position.end) move('right'); }} onKeyDown={key}>Scroll right</button>
    </div></div>}
    {children}</div></div>
  </div>;
}
