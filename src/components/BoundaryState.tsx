import { useId, useRef, type MouseEventHandler } from 'react';
import type { RouteState } from '../data/boundary';
const messages = {
  loading: ['Loading', 'Loading the requested information.'],
  empty: ['No records', 'No records were returned for this view. No financial total is implied.'],
  error: ['Could not load this route', 'This information could not be loaded. No financial values are available.'],
  restricted: ['Access restricted', 'The host has not granted access to this content.'],
  unavailable: ['Upstream unavailable', 'Authoritative financial information is not connected for this view. No amount is available.'],
} as const;
export type BoundaryExit = Readonly<{ href: string; label: string; onNavigate: MouseEventHandler<HTMLAnchorElement> }>;
export function BoundaryState({ state, onRetry, exit }: { state: Exclude<RouteState, { status: 'ready' }>; onRetry?: () => void; exit?: BoundaryExit | undefined }) {
  const [title, description] = messages[state.status];
  const titleId = useId();
  const region = useRef<HTMLElement>(null);
  const failed = state.status === 'error';
  // The retry button unmounts while the read restarts; keep keyboard focus inside this boundary instead of dropping it to <body>.
  function retry() { region.current?.focus(); onRetry?.(); }
  return <section ref={region} tabIndex={-1} className="td-boundary" aria-labelledby={titleId} aria-busy={state.status === 'loading'}>
    <div key={state.status} role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
      <h2 id={titleId}>{title}</h2><p>{description}</p>
    </div>
    {failed && state.retryable && onRetry && <button type="button" onClick={retry}>Retry read</button>}
    {state.status !== 'loading' && exit && <p><a href={exit.href} onClick={exit.onNavigate}>{exit.label}</a></p>}
  </section>;
}
