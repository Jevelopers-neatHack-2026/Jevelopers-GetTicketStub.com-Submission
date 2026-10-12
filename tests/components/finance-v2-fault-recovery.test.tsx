import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FinanceV2ConnectedView, classifyFinanceV2Fault, resolveFinanceV2Port,
  type FinanceV2ConnectedViewProps, type FinanceV2ReadRequest, type FinanceV2SyntheticReadPort,
} from '../../src';
import {
  syntheticOpaqueScope, syntheticQueryContentHash, syntheticSnapshotId, syntheticSummaryContentHash,
} from '../../src/views/finance-v2/fixtures';

// TEST_BUILT failures and host assertions only; these tests grant no integrated authority.
const CANARY = 'TD_FAULT_TEST_CANARY';
const FAILED = { outcome: 'error', kind: 'failed', retryable: false } as const;
const properties = ['status', 'code', 'name'] as const;
const unreadable: readonly (readonly [string, () => unknown])[] = [
  ...properties.map((property) => [property, () => Object.defineProperty({}, property, {
    get() { throw new Error(CANARY); },
  })] as const),
  ['throwing proxy', () => new Proxy({}, { get() { throw new Error(CANARY); } })],
  ['revoked proxy', () => { const value = Proxy.revocable({}, {}); value.revoke(); return value.proxy; }],
];

type SyntheticProps = Extract<FinanceV2ConnectedViewProps, { mode: 'SYNTHETIC_PROPOSAL' }>;
function connected(port: FinanceV2SyntheticReadPort, over: Partial<SyntheticProps> = {}): SyntheticProps {
  return {
    mode: 'SYNTHETIC_PROPOSAL', view: 'budget', port, availability: { status: 'available' },
    scope: syntheticOpaqueScope, expectedSnapshotId: syntheticSnapshotId,
    expectedQueryContentHash: syntheticQueryContentHash, expectedSummaryContentHash: syntheticSummaryContentHash,
    authorization: { revision: '1', token: async () => 'synthetic-token' }, ...over,
  };
}
type Pending = {
  request: FinanceV2ReadRequest;
  resolve: (value: Awaited<ReturnType<FinanceV2SyntheticReadPort['read']>>) => void;
  reject: (error: unknown) => void;
};
function manualPort() {
  const pending: Pending[] = [];
  const port: FinanceV2SyntheticReadPort = {
    kind: 'SYNTHETIC_PROPOSAL',
    read: (request) => new Promise((resolve, reject) => { pending.push({ request, resolve, reject }); }),
  };
  return { port, pending };
}
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
function assertSafeFailure() {
  expect(screen.getByRole('alert')).toHaveTextContent('The report could not be loaded. No amounts are shown.');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.queryAllByText(/\d\.0{18}/u)).toHaveLength(0);
  expect(screen.queryByRole('table')).toBeNull();
  expect(document.body.innerHTML).not.toContain(CANARY);
  expect(document.body.innerHTML).not.toContain('synthetic-token');
}
function lateError() {
  const inspect = vi.fn(() => { throw new Error(CANARY); });
  return { error: Object.defineProperty({}, 'status', { get: inspect }), inspect };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('fault classification contains unreadable metadata', () => {
  it.each(unreadable)('returns a non-retryable failure for %s instead of throwing', (_name, makeError) => {
    expect(classifyFinanceV2Fault(makeError())).toEqual(FAILED);
  });
  it.each([
    [{ status: 401 }, { outcome: 'unauthorized' }],
    [{ status: 403 }, { outcome: 'restricted' }],
    [{ status: 404 }, { outcome: 'missing' }],
    [{ status: 429 }, { outcome: 'error', kind: 'rate_limited', retryable: true }],
    [{ status: 500 }, { outcome: 'error', kind: 'server', retryable: true }],
    [{ status: 599 }, { outcome: 'error', kind: 'server', retryable: true }],
    [{ code: 'TIMEOUT' }, { outcome: 'error', kind: 'timeout', retryable: true }],
    [{ name: 'TimeoutError' }, { outcome: 'error', kind: 'timeout', retryable: true }],
    [new DOMException('', 'TimeoutError'), { outcome: 'error', kind: 'timeout', retryable: true }],
    [null, FAILED], [undefined, FAILED], [{ status: '500' }, FAILED], [{ status: 500.5 }, FAILED], [{ status: 600 }, FAILED],
  ])('preserves the ordinary classification for %#', (error, expected) => {
    expect(classifyFinanceV2Fault(error)).toEqual(expected);
  });
  it('preserves a readable status accessor without reading sensitive error fields', () => {
    const inspectSensitive = vi.fn(() => { throw new Error(CANARY); });
    const error = Object.defineProperty({}, 'status', { get: () => 429 });
    for (const field of ['message', 'body', 'headers', 'stack', 'response']) {
      Object.defineProperty(error, field, { get: inspectSensitive });
    }
    expect(classifyFinanceV2Fault(error)).toEqual({ outcome: 'error', kind: 'rate_limited', retryable: true });
    expect(inspectSensitive).not.toHaveBeenCalled();
  });
  it('does not inspect any smuggled port in INTEGRATED mode', () => {
    const { error, inspect } = lateError();
    expect(resolveFinanceV2Port('INTEGRATED', error)).toEqual({ status: 'unavailable', reason: 'integrated-port-not-accepted' });
    expect(inspect).not.toHaveBeenCalled();
  });
});

describe('connected recovery from malformed adapter failures', () => {
  it.each(unreadable)('settles %s into the accessible generic failure without an unhandled rejection', async (_name, makeError) => {
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    expect(pending).toHaveLength(1);
    await act(async () => { pending[0]!.reject(makeError()); });
    assertSafeFailure();
  });
  it('contains malformed token-provider failures without starting a data read', async () => {
    const read = vi.fn(async () => ({ status: 'missing' as const }));
    const port: FinanceV2SyntheticReadPort = { kind: 'SYNTHETIC_PROPOSAL', read };
    const { error } = lateError();
    render(<FinanceV2ConnectedView {...connected(port, { authorization: { revision: '1', token: async () => { throw error; } } })} />);
    await settle();
    assertSafeFailure();
    expect(read).not.toHaveBeenCalled();
  });
  it('starts a fresh read after the host replaces the failed authorization generation', async () => {
    const { port, pending } = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    await act(async () => { pending[0]!.reject(unreadable[0]![1]()); });
    assertSafeFailure();
    view.rerender(<FinanceV2ConnectedView {...connected(port, { authorization: { revision: '2', token: async () => 'synthetic-token-2' } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the report');
    await settle();
    expect(pending).toHaveLength(2);
    expect(pending[1]!.request.authorization.revision).toBe('2');
    await act(async () => { pending[1]!.resolve({ status: 'missing' }); });
    expect(document.body.textContent).toContain('No Finance v2 report has been delivered');
    expect(document.body.innerHTML).not.toContain(CANARY);
    expect(document.body.innerHTML).not.toContain('synthetic-token');
  });
});

describe('cancelled generations discard late rejections before inspection', () => {
  it('does not inspect a rejection after unmount', async () => {
    const { port, pending } = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    view.unmount();
    expect(pending[0]!.request.signal.aborted).toBe(true);
    const { error, inspect } = lateError();
    await act(async () => { pending[0]!.reject(error); });
    expect(inspect).not.toHaveBeenCalled();
  });
  it('does not inspect a rejection after host access is revoked', async () => {
    const { port, pending } = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    view.rerender(<FinanceV2ConnectedView {...connected(port, { availability: { status: 'refused', reason: 'restricted' } })} />);
    expect(pending[0]!.request.signal.aborted).toBe(true);
    const { error, inspect } = lateError();
    await act(async () => { pending[0]!.reject(error); });
    expect(inspect).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('restricted');
  });
  it('does not inspect the old rejection after the authorization revision changes', async () => {
    const { port, pending } = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    view.rerender(<FinanceV2ConnectedView {...connected(port, { authorization: { revision: '2', token: async () => 'synthetic-token-2' } })} />);
    await settle();
    expect(pending).toHaveLength(2);
    expect(pending[0]!.request.signal.aborted).toBe(true);
    const { error, inspect } = lateError();
    await act(async () => { pending[0]!.reject(error); });
    expect(inspect).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the report');
    await act(async () => { pending[1]!.resolve({ status: 'missing' }); });
    expect(document.body.textContent).toContain('No Finance v2 report has been delivered');
  });
  it('does not inspect a rejection after timeout has already settled the read', async () => {
    vi.useFakeTimers();
    const { port, pending } = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(port, { timeoutMs: 30 })} />);
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    expect(pending[0]!.request.signal.aborted).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('did not answer in time');
    const { error, inspect } = lateError();
    await act(async () => { pending[0]!.reject(error); });
    expect(inspect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    view.unmount();
  });
});
