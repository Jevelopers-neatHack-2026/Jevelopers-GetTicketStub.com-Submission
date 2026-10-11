import type { RouteState } from '../data/boundary';
const messages = {
  loading: ['Loading', 'Loading the requested information.'],
  empty: ['No records', 'No records were returned for this view. No financial total is implied.'],
  error: ['Could not load this route', 'This information could not be loaded. No financial values are available.'],
  restricted: ['Access restricted', 'The host has not granted access to this content.'],
  unavailable: ['Upstream unavailable', 'Authoritative financial information is not connected for this view. No amount is available.'],
} as const;
export function BoundaryState({ state, onRetry }: { state: Exclude<RouteState, { status: 'ready' }>; onRetry?: () => void }) {
  const [title, description] = messages[state.status];
  return <section className="td-boundary" aria-busy={state.status === 'loading'}>
    <div role={state.status === 'error' ? 'alert' : 'status'} aria-live={state.status === 'error' ? 'assertive' : 'polite'}>
      <h2>{title}</h2><p>{description}</p>
    </div>
    {state.status === 'error' && state.retryable && onRetry && <button type="button" onClick={onRetry}>Retry read</button>}
  </section>;
}
