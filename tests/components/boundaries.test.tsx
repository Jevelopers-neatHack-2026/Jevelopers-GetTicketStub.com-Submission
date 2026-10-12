import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard, type DashboardProps, type RouteProvider, type RouteState } from '../../src';
import type { RouteReadResult } from '../../integration';
import { fixtureAccess } from '../fixtures/td01';
const base: DashboardProps<string> = { basePath: '/admin/finance', pathname: '/admin/finance', navigate: vi.fn(), access: fixtureAccess };
const result = (state: RouteState<string>, access = fixtureAccess): RouteReadResult<string> => ({ state, access });
const provider = (state: RouteState<string>): RouteProvider<string> => ({ mode: 'fixture', readRoute: vi.fn().mockResolvedValue(result(state)) });
describe('TD-01 route boundaries', () => {
  it.each([['empty', 'No records'], ['error', 'Could not load this route'], ['restricted', 'Access restricted'], ['unavailable', 'Upstream unavailable']] as const)('renders %s without amounts', async (status, label) => {
    render(<Dashboard {...base} provider={provider(status === 'error' ? { status, retryable: true } : { status })} />);
    expect(await screen.findByRole('heading', { name: label })).toBeVisible();
    expect(screen.queryByText(/\$0|0\.00/u)).not.toBeInTheDocument();
  });
  it('fails closed without access, provider or rendering extension', async () => {
    const p = provider({ status: 'ready', data: 'sensitive-canary' });
    const { rerender } = render(<Dashboard {...base} access={undefined} provider={p} />);
    expect(screen.getByText('Access restricted')).toBeVisible(); expect(p.readRoute).not.toHaveBeenCalled();
    rerender(<Dashboard {...base} />); expect(screen.getByText('Upstream unavailable')).toBeVisible();
    rerender(<Dashboard {...base} provider={p} />); expect(await screen.findByText('Upstream unavailable')).toBeVisible(); expect(screen.queryByText('sensitive-canary')).toBeNull();
  });
  it('does not read while host auth is loading', () => {
    const p = provider({ status: 'empty' }); render(<Dashboard {...base} access={{ status: 'loading' }} provider={p} />);
    expect(screen.getByText('Loading')).toBeVisible(); expect(p.readRoute).not.toHaveBeenCalled();
  });
  it('uses safe errors, retries reads and rejects malformed states', async () => {
    const p: RouteProvider<string> = { mode: 'fixture', readRoute: vi.fn().mockRejectedValueOnce(new Error('secret-canary')).mockResolvedValueOnce(result({ status: 'empty' })) };
    const { rerender } = render(<Dashboard {...base} provider={p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry read' }));
    expect(await screen.findByText('No records')).toBeVisible(); expect(screen.queryByText('secret-canary')).toBeNull();
    rerender(<Dashboard {...base} provider={{ mode: 'fixture', readRoute: vi.fn().mockResolvedValue({ status: 'nonsense', message: 'secret-canary' }) }} />);
    expect(await screen.findByText('Could not load this route')).toBeVisible(); expect(screen.queryByText('secret-canary')).toBeNull();
  });
  it('aborts stale scope reads and never renders old values after revocation', async () => {
    let resolveOld!: (state: RouteState<string>) => void;
    let oldSignal: AbortSignal | undefined;
    const p: RouteProvider<string> = { mode: 'fixture', readRoute: vi.fn(({ signal }) => { oldSignal ??= signal; return new Promise<RouteReadResult<string>>((resolve) => { resolveOld = (state) => resolve(result(state)); }); }) };
    const { rerender } = render(<Dashboard {...base} provider={p} renderRoute={({ data }) => <p>{data}</p>} />);
    await waitFor(() => expect(p.readRoute).toHaveBeenCalledOnce());
    rerender(<Dashboard {...base} provider={p} access={{ status: 'restricted' }} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => resolveOld({ status: 'ready', data: 'old-scope-canary' }));
    expect(screen.queryByText('old-scope-canary')).toBeNull(); expect(screen.getByText('Access restricted')).toBeVisible();
  });
  it('preserves host navigation and moves focus to the route heading', () => {
    const navigate = vi.fn(); const { rerender } = render(<Dashboard {...base} navigate={navigate} />);
    fireEvent.click(screen.getByRole('link', { name: 'AI costs' })); expect(navigate).toHaveBeenCalledWith('/admin/finance/ai-costs');
    rerender(<Dashboard {...base} pathname="/admin/finance/ai-costs" navigate={navigate} />);
    expect(screen.getByRole('heading', { name: 'AI costs', level: 1 })).toHaveFocus();
  });
});

describe('TD-01 read lifecycle regressions', () => {
  it('clears a settled result immediately on revision change and refuses a response bound to the old revision', async () => {
    const p = provider({ status: 'ready', data: 'old-revision-canary' });
    const { rerender } = render(<Dashboard {...base} provider={p} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(await screen.findByText('old-revision-canary')).toBeVisible();
    const nextAccess = { ...fixtureAccess, revision: 'fixture-grant-v2' };
    rerender(<Dashboard {...base} access={nextAccess} provider={p} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(screen.queryByText('old-revision-canary')).toBeNull();
    expect(await screen.findByText('Access restricted')).toBeVisible();
    rerender(<Dashboard {...base} access={nextAccess} provider={{ mode: 'fixture', readRoute: async () => result({ status: 'ready', data: 'current-revision' }, nextAccess) }} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(await screen.findByText('current-revision')).toBeVisible();
  });

  it('rejects an accessor page projection without invoking it or starting a read', () => {
    const getter = vi.fn(() => { throw new Error('synthetic-secret-error'); });
    const p = provider({ status: 'ready', data: 'synthetic-canary' });
    render(<Dashboard {...base} access={Object.defineProperty({}, 'status', { get: getter }) as typeof fixtureAccess} provider={p} />);
    expect(screen.getByText('Access restricted')).toBeVisible();
    expect(getter).not.toHaveBeenCalled();
    expect(p.readRoute).not.toHaveBeenCalled();
  });

  it('does not reveal old scope when a new authorized scope resolves first', async () => {
    const pending = new Map<string, (state: RouteState<string>) => void>();
    const nextAccess = { status: 'authorized' as const, scope: { tenantId: 'fixture-tenant-b', projectId: 'fixture-project-b' }, revision: 'grant-b' };
    const p: RouteProvider<string> = { mode: 'integrated', readRoute: ({ scope }) => new Promise((resolve) => pending.set(scope.projectId, (state) => resolve(result(state, scope.projectId === nextAccess.scope.projectId ? nextAccess : fixtureAccess)))) };
    const { rerender } = render(<Dashboard {...base} provider={p} renderRoute={({ data }) => <p>{data}</p>} />);
    await waitFor(() => expect(pending.has('fixture-project-a')).toBe(true));
    rerender(<Dashboard {...base} access={nextAccess} provider={p} renderRoute={({ data }) => <p>{data}</p>} />);
    await waitFor(() => expect(pending.has('fixture-project-b')).toBe(true));
    await act(async () => pending.get('fixture-project-b')!({ status: 'ready', data: 'current-scope' }));
    expect(screen.getByText('current-scope')).toBeVisible();
    await act(async () => pending.get('fixture-project-a')!({ status: 'ready', data: 'old-scope-canary' }));
    expect(screen.queryByText('old-scope-canary')).toBeNull(); expect(screen.getByText('current-scope')).toBeVisible();
  });
  it('clears data immediately when the provider identity changes', async () => {
    const old = provider({ status: 'ready', data: 'old-provider-canary' });
    const { rerender } = render(<Dashboard {...base} provider={old} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(await screen.findByText('old-provider-canary')).toBeVisible();
    const next: RouteProvider<string> = { mode: 'integrated', readRoute: () => new Promise(() => {}) };
    rerender(<Dashboard {...base} provider={next} renderRoute={({ data }) => <p>{data}</p>} />);
    expect(screen.queryByText('old-provider-canary')).toBeNull(); expect(screen.getByText('Loading')).toBeVisible();
  });
  it('bounds a stalled read and aborts it without rendering late data', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const p: RouteProvider<string> = { mode: 'fixture', readRoute: (request) => { signal = request.signal; return new Promise(() => {}); } };
      render(<Dashboard {...base} provider={p} />);
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText('Loading')).toBeVisible();
      await act(async () => vi.advanceTimersByTime(15000));
      expect(screen.getByText('Could not load this route')).toBeVisible(); expect(signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('TD-09.D recovery actions and focus', () => {
  const ai = { ...base, pathname: '/admin/finance/ai-costs' };
  it.each([['empty'], ['restricted'], ['unavailable'], ['error']] as const)('offers a safe route out of %s without implying an amount', async (status) => {
    const navigate = vi.fn();
    render(<Dashboard {...ai} navigate={navigate} provider={provider(status === 'error' ? { status, retryable: false } : { status })} />);
    const exit = await screen.findByRole('link', { name: 'Return to overview' });
    expect(screen.queryByRole('button', { name: 'Retry read' })).toBeNull();
    fireEvent.click(exit); expect(navigate).toHaveBeenCalledWith('/admin/finance');
    expect(screen.queryByText(/\$|0\.00/u)).not.toBeInTheDocument();
  });
  it('offers the exit when host access is restricted, but never on the overview or while loading', async () => {
    const { rerender } = render(<Dashboard {...ai} access={{ status: 'restricted' }} />);
    expect(screen.getByRole('link', { name: 'Return to overview' })).toBeVisible();
    rerender(<Dashboard {...ai} access={{ status: 'loading' }} />);
    expect(screen.queryByRole('link', { name: 'Return to overview' })).toBeNull();
    rerender(<Dashboard {...base} access={{ status: 'restricted' }} />);
    expect(screen.queryByRole('link', { name: 'Return to overview' })).toBeNull();
    rerender(<Dashboard {...base} provider={provider({ status: 'empty' })} />);
    expect(await screen.findByText('No records')).toBeVisible(); expect(screen.queryByRole('link', { name: 'Return to overview' })).toBeNull();
  });
  it('keeps keyboard focus inside the boundary when retry replaces the button', async () => {
    let finish!: (state: RouteState<string>) => void;
    const p: RouteProvider<string> = { mode: 'fixture', readRoute: vi.fn().mockResolvedValueOnce(result({ status: 'error', retryable: true })).mockImplementationOnce(() => new Promise<RouteReadResult<string>>((resolve) => { finish = (state) => resolve(result(state)); })) };
    render(<Dashboard {...ai} provider={p} />);
    const retry = await screen.findByRole('button', { name: 'Retry read' }); retry.focus(); fireEvent.click(retry);
    expect(await screen.findByText('Loading')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Loading' })).toHaveFocus();
    expect(document.body).not.toHaveFocus();
    await act(async () => finish({ status: 'empty' }));
    expect(await screen.findByText('No records')).toBeVisible();
  });
  it('announces errors assertively and other states politely in regions that stay mounted', async () => {
    let finish!: (state: RouteState<string>) => void;
    const p: RouteProvider<string> = { mode: 'fixture', readRoute: vi.fn().mockResolvedValueOnce(result({ status: 'error', retryable: true })).mockImplementationOnce(() => new Promise<RouteReadResult<string>>((resolve) => { finish = (state) => resolve(result(state)); })) };
    render(<Dashboard {...ai} provider={p} />);
    const status = screen.getByRole('status'); const alert = screen.getByRole('alert');
    expect(status).toHaveAttribute('aria-live', 'polite'); expect(alert).toHaveAttribute('aria-live', 'assertive');
    await waitFor(() => expect(alert).toHaveTextContent('Could not load this route'));
    expect(status).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: 'Retry read' }));
    expect(status).toHaveTextContent('Loading'); expect(alert).toBeEmptyDOMElement();
    await act(async () => { await Promise.resolve(); });
    await act(async () => finish({ status: 'empty' }));
    expect(status).toHaveTextContent('No records');
    expect(screen.getByRole('status')).toBe(status); expect(screen.getByRole('alert')).toBe(alert);
  });
  it('keeps one polite region from loading to empty', async () => {
    let finish!: (state: RouteState<string>) => void;
    const p: RouteProvider<string> = { mode: 'fixture', readRoute: () => new Promise<RouteReadResult<string>>((resolve) => { finish = (state) => resolve(result(state)); }) };
    render(<Dashboard {...ai} provider={p} />);
    const status = screen.getByRole('status');
    await act(async () => { await Promise.resolve(); });
    await act(async () => finish({ status: 'empty' }));
    expect(screen.getByRole('status')).toBe(status); expect(status).toHaveTextContent('No records');
  });
  const retried = async () => {
    let finish!: (state: RouteState<string>) => void;
    const p: RouteProvider<string> = { mode: 'fixture', readRoute: vi.fn().mockResolvedValueOnce(result({ status: 'error', retryable: true })).mockImplementationOnce(() => new Promise<RouteReadResult<string>>((resolve) => { finish = (state) => resolve(result(state)); })) };
    render(<Dashboard {...ai} provider={p} renderRoute={({ data }) => <section><h2>Read succeeded</h2><button type="button">{data}</button></section>} />);
    const retry = await screen.findByRole('button', { name: 'Retry read' }); retry.focus(); fireEvent.click(retry);
    expect(screen.getByRole('region', { name: 'Loading' })).toHaveFocus();
    await act(async () => { await Promise.resolve(); });
    return finish;
  };
  it('moves focus to the route content when a delayed retry succeeds', async () => {
    const finish = await retried();
    await act(async () => finish({ status: 'ready', data: 'Open details' }));
    expect(screen.getByText('Read succeeded')).toBeVisible();
    expect(document.getElementById('td-route-content')).toHaveFocus();
  });
  it('does not steal focus when the user moved elsewhere before the retry succeeds', async () => {
    const finish = await retried();
    const nav = screen.getByRole('link', { name: 'Overview' }); nav.focus();
    await act(async () => finish({ status: 'ready', data: 'Open details' }));
    expect(screen.getByText('Read succeeded')).toBeVisible();
    expect(nav).toHaveFocus();
  });
  it('does not pull focus into the page when the user released focus before the retry succeeds', async () => {
    const finish = await retried();
    (document.activeElement as HTMLElement).blur();
    await act(async () => finish({ status: 'ready', data: 'Open details' }));
    expect(screen.getByText('Read succeeded')).toBeVisible();
    expect(document.body).toHaveFocus();
  });
});
