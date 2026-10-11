export function LockIcon({ open = false, title }: { open?: boolean; title?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      {open ? <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" /> : <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />}
    </svg>
  );
}
