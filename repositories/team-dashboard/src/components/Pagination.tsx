export function Pagination({ pageLabel, hasPrevious, hasNext, onNavigate, label = 'Result pages' }: {
  pageLabel: string; hasPrevious: boolean; hasNext: boolean; onNavigate: (direction: 'previous' | 'next') => void; label?: string;
}) {
  return <nav className="td-pagination" aria-label={label}>
    <button type="button" disabled={!hasPrevious} onClick={() => { if (hasPrevious) onNavigate('previous'); }}>Previous page</button>
    <span role="status" aria-live="polite">{pageLabel}</span>
    <button type="button" disabled={!hasNext} onClick={() => { if (hasNext) onNavigate('next'); }}>Next page</button>
  </nav>;
}
