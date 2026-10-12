import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  FinanceV2ConnectedView, resolveFinanceV2Port,
  type FinanceV2ConnectedViewProps, type FinanceV2Input, type FinanceV2ReadRequest, type FinanceV2SyntheticReadPort,
} from '../../src';
import {
  financeV2Fixture, syntheticOpaqueScope, syntheticQueryContentHash, syntheticSnapshotId, syntheticSummaryContentHash,
} from '../../src/views/finance-v2/fixtures';

// TEST_BUILT malformed ports and host assertions; no accepted integrated authority is supplied.
const CANARY = 'TD_PORT_TEST_CANARY';
const mismatch = { status: 'unavailable', reason: 'port-kind-mismatch' } as const;
const broken: readonly (readonly [string, (inspect: () => never) => unknown])[] = [
  ['kind getter', (inspect) => Object.defineProperty({}, 'kind', { get: inspect })],
  ['read getter', (inspect) => Object.defineProperty({ kind: 'SYNTHETIC_PROPOSAL' }, 'read', { get: inspect })],
  ['throwing proxy', (inspect) => new Proxy({}, { get: inspect })],
  ['revoked proxy', () => { const value = Proxy.revocable({}, {}); value.revoke(); return value.proxy; }],
];
const unreadable = () => { throw new Error(CANARY); };
function connected(port: unknown, token = vi.fn(async () => 'synthetic-port-token')): FinanceV2ConnectedViewProps {
  return {
    mode: 'SYNTHETIC_PROPOSAL', view: 'budget', port: port as FinanceV2SyntheticReadPort,
    availability: { status: 'available' }, scope: syntheticOpaqueScope, expectedSnapshotId: syntheticSnapshotId,
    expectedQueryContentHash: syntheticQueryContentHash, expectedSummaryContentHash: syntheticSummaryContentHash,
    authorization: { revision: '1', token },
  };
}
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const amounts = () => screen.queryAllByText(/\d\.0{18}/u);
function assertUnavailable() {
  expect(screen.getByRole('status')).toHaveTextContent('The provided read port is not usable in this mode');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(amounts()).toHaveLength(0);
  expect(document.body.innerHTML).not.toContain(CANARY);
  expect(document.body.innerHTML).not.toContain('synthetic-port-token');
}

describe('read-port resolution contains unreadable metadata', () => {
  it.each(broken)('refuses a %s without throwing', (_name, make) => {
    expect(resolveFinanceV2Port('SYNTHETIC_PROPOSAL', make(unreadable))).toEqual(mismatch);
  });
  it.each(broken)('never inspects a %s in INTEGRATED mode', (_name, make) => {
    const inspect = vi.fn(unreadable);
    expect(resolveFinanceV2Port('INTEGRATED', make(inspect))).toEqual({ status: 'unavailable', reason: 'integrated-port-not-accepted' });
    expect(inspect).not.toHaveBeenCalled();
  });
  it.each([undefined, null])('keeps absent %s distinct from malformed metadata', (port) => {
    expect(resolveFinanceV2Port('SYNTHETIC_PROPOSAL', port)).toEqual({ status: 'unavailable', reason: 'no-port' });
  });
  it('preserves readable accessor ports by identity without invoking read during resolution', () => {
    const read = vi.fn(async () => ({ status: 'missing' as const }));
    const port = { get kind() { return 'SYNTHETIC_PROPOSAL'; }, get read() { return read; } };
    expect(resolveFinanceV2Port('SYNTHETIC_PROPOSAL', port)).toEqual({ status: 'available', port });
    expect(read).not.toHaveBeenCalled();
  });
  it('keeps ordinary invalid kinds and shapes unavailable', () => {
    for (const port of ['port', 1, [], {}, { kind: 'ACCEPTED', read() {} }, { kind: 'SYNTHETIC_PROPOSAL', read: false }]) {
      expect(resolveFinanceV2Port('SYNTHETIC_PROPOSAL', port)).toEqual(mismatch);
    }
  });
});

describe('connected read-port failure and recovery', () => {
  it.each(broken)('renders a %s as unavailable before requesting a token', async (_name, make) => {
    const token = vi.fn(async () => 'synthetic-port-token');
    render(<FinanceV2ConnectedView {...connected(make(unreadable), token)} />);
    await settle();
    assertUnavailable();
    expect(token).not.toHaveBeenCalled();
  });
  it('recovers after the host replaces an unreadable port, without an automatic fixture fallback', async () => {
    const token = vi.fn(async () => 'synthetic-port-token');
    const view = render(<FinanceV2ConnectedView {...connected(broken[0]![1](unreadable), token)} />);
    await settle();
    assertUnavailable();
    expect(token).not.toHaveBeenCalled();
    const read = vi.fn(async () => ({ status: 'missing' as const }));
    const port: FinanceV2SyntheticReadPort = { kind: 'SYNTHETIC_PROPOSAL', read };
    view.rerender(<FinanceV2ConnectedView {...connected(port, token)} />);
    await waitFor(() => expect(document.body.textContent).toContain('No Finance v2 report has been delivered'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(token).toHaveBeenCalledTimes(1);
    expect(amounts()).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain(CANARY);
  });
  it('withdraws settled fixture amounts immediately when the replacement port is unreadable', async () => {
    const port: FinanceV2SyntheticReadPort = { kind: 'SYNTHETIC_PROPOSAL', read: async () => financeV2Fixture('ready').input };
    const view = render(<FinanceV2ConnectedView {...connected(port)} />);
    await waitFor(() => expect(amounts().length).toBeGreaterThan(0));
    view.rerender(<FinanceV2ConnectedView {...connected(broken[1]![1](unreadable))} />);
    assertUnavailable();
    await settle();
    assertUnavailable();
  });
  it('aborts the previous read and drops its late fixture answer after an unreadable replacement', async () => {
    let pending: { request: FinanceV2ReadRequest; resolve: (input: FinanceV2Input) => void } | undefined;
    const port: FinanceV2SyntheticReadPort = {
      kind: 'SYNTHETIC_PROPOSAL',
      read: (request) => new Promise((resolve) => { pending = { request, resolve }; }),
    };
    const view = render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    expect(pending).toBeDefined();
    view.rerender(<FinanceV2ConnectedView {...connected(broken[2]![1](unreadable))} />);
    expect(pending!.request.signal.aborted).toBe(true);
    assertUnavailable();
    await act(async () => { pending!.resolve(financeV2Fixture('ready').input); });
    assertUnavailable();
  });
  it.each(['kind', 'read'] as const)('settles when %s becomes unreadable during effect setup and recovers on replacement', async (property) => {
    let observations = 0;
    const token = vi.fn(async () => 'synthetic-port-token');
    const read = vi.fn(async () => ({ status: 'missing' as const }));
    const port = Object.defineProperty({ kind: 'SYNTHETIC_PROPOSAL', read }, property, {
      get() {
        observations += 1;
        if (observations === 2) throw new Error(CANARY);
        return property === 'kind' ? 'SYNTHETIC_PROPOSAL' : read;
      },
    });
    const view = render(<FinanceV2ConnectedView {...connected(port, token)} />);
    await settle();
    assertUnavailable();
    expect(token).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    const replacement: FinanceV2SyntheticReadPort = { kind: 'SYNTHETIC_PROPOSAL', read };
    view.rerender(<FinanceV2ConnectedView {...connected(replacement, token)} />);
    await waitFor(() => expect(document.body.textContent).toContain('No Finance v2 report has been delivered'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(token).toHaveBeenCalledTimes(1);
    expect(amounts()).toHaveLength(0);
  });
  it('preserves the method receiver of a readable accessor port during the connected read', async () => {
    const read = vi.fn(function (this: unknown) {
      expect(this).toBe(port);
      return Promise.resolve({ status: 'missing' as const });
    });
    const port = { get kind() { return 'SYNTHETIC_PROPOSAL' as const; }, get read() { return read; } };
    render(<FinanceV2ConnectedView {...connected(port)} />);
    await waitFor(() => expect(document.body.textContent).toContain('No Finance v2 report has been delivered'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(amounts()).toHaveLength(0);
  });
});
