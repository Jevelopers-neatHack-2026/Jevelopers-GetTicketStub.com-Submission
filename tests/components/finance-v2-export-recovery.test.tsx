import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FINANCE_V2_EXPORT_KIND, PreparedExportPanel, resolveFinanceV2ExportPort, usePreparedExport,
  type FinanceV2ExportHostAccess, type FinanceV2Page, type FinanceV2PreparedExportOptions, type FinanceV2SyntheticExportPort, type OpaqueProductScope,
} from '../../src/views/finance-v2';
import { financeV2Fixture } from '../../src/views/finance-v2/fixtures';
import { FINANCE_EXPORT, FINANCE_READ } from '../../src/access/permissions';
import { ZERO, ok, receiptZero } from './export-support';

// TEST_BUILT host, ports and failures. The unchanged captured receipt is only a
// recovery control; no actual issuer, Finance execution, CFO delivery or ACK.
const CANARY = 'TEST_BUILT_EXPORT_FAILURE_DO_NOT_ECHO';
const SCOPE: OpaqueProductScope = {
  tenantId: 'account:synthetic-tenant', projectId: 'event:synthetic-project',
  environment: 'test', billingMode: 'live', actorId: 'account:synthetic-actor',
};
function fixture(port: unknown) {
  const host: { current: FinanceV2ExportHostAccess } = { current: {
    revision: '1', scope: SCOPE, capabilities: [FINANCE_READ, FINANCE_EXPORT], expiresAt: '2099-01-01T00:00:00Z',
  } };
  const page: FinanceV2Page = {
    ...structuredClone((financeV2Fixture('ready').input as { page: FinanceV2Page }).page),
    snapshotId: ZERO.snapshotId, queryContentHash: ZERO.queryContentHash, summaryContentHash: ZERO.summaryContentHash,
    asOf: ZERO.asOf, period: { ...ZERO.period }, scope: SCOPE, filters: { environments: ['test'], billingModes: ['live'] },
  };
  const options: FinanceV2PreparedExportOptions = {
    mode: 'SYNTHETIC_PROPOSAL', port, access: () => host.current,
    authorization: { revision: '1', token: async () => 'TEST_BUILT_PRIVATE_EXPORT_TOKEN' }, scope: SCOPE,
    expectedSnapshotId: ZERO.snapshotId, expectedQueryContentHash: ZERO.queryContentHash, expectedSummaryContentHash: ZERO.summaryContentHash,
    page, firstPage: true,
  };
  return { host, options };
}
const prepared = () => ok(receiptZero().receipt);
const throwing = (key: string) => Object.defineProperty({}, key, { get() { throw new Error(CANARY); } });
function revoked() { const p = Proxy.revocable({}, {}); p.revoke(); return p.proxy; }
const unreadablePorts: readonly (readonly [string, () => unknown])[] = [
  ['kind getter', () => throwing('kind')],
  ['prepare getter', () => Object.assign(throwing('prepare'), { kind: FINANCE_V2_EXPORT_KIND })],
  ['get trap', () => new Proxy({}, { get() { throw new Error(CANARY); } })],
  ['revoked proxy', revoked],
];
const unreadableFailures: readonly (readonly [string, () => unknown])[] = [
  ['prototype trap', () => new Proxy({}, { getPrototypeOf() { throw new Error(CANARY); } })],
  ['revoked proxy', revoked],
  ['status getter', () => throwing('status')],
  ['code getter', () => throwing('code')],
  ['name getter', () => throwing('name')],
  ['get trap', () => new Proxy({}, { get() { throw new Error(CANARY); } })],
  ['external stale symbol', () => Symbol('stale')],
  ['external veto symbol', () => Symbol('vetoed')],
];
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:TEST_BUILT') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });

function assertNoDisclosure() {
  expect(screen.queryByRole('button', { name: /^Download /u })).toBeNull();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain(CANARY);
  expect(document.body.textContent).not.toContain('TEST_BUILT_PRIVATE_EXPORT_TOKEN');
}

describe('unreadable export port resolution', () => {
  it.each(unreadablePorts)('%s returns the existing unavailable state without preparing', (_name, make) => {
    const port = make();
    expect(resolveFinanceV2ExportPort('SYNTHETIC_PROPOSAL', port)).toEqual({ status: 'unavailable', reason: 'port-kind-mismatch' });
    render(<PreparedExportPanel {...fixture(port).options} />);
    expect(screen.getByRole('status')).toHaveTextContent('not usable in this mode');
    expect(screen.getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
    assertNoDisclosure();
  });
  it('preserves a readable accessor port and the original method receiver', async () => {
    const prepare = vi.fn(async function prepare(this: unknown) { expect(this).toBe(port); return prepared(); });
    const port = { get kind() { return FINANCE_V2_EXPORT_KIND; }, get prepare() { return prepare; } };
    const { options } = fixture(port);
    const { result } = renderHook(() => usePreparedExport(options));
    act(() => result.current.prepare());
    await waitFor(() => expect(result.current.state.phase).toBe('prepared'));
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('does not inspect any port properties in integrated mode', () => {
    const get = vi.fn(() => { throw new Error(CANARY); });
    const port = new Proxy({}, { get });
    render(<PreparedExportPanel {...fixture(port).options} mode="INTEGRATED" />);
    expect(screen.getByRole('status')).toHaveTextContent('no accepted export port exists');
    expect(get).not.toHaveBeenCalled();
    assertNoDisclosure();
  });
});

describe('export rejection containment and recovery', () => {
  it.each(unreadableFailures)('%s settles into fixed failure copy and releases the run for recovery', async (_name, make) => {
    let fail = true;
    const prepare = vi.fn(async () => { if (fail) throw make(); return prepared(); });
    const { options } = fixture({ kind: FINANCE_V2_EXPORT_KIND, prepare });
    render(<PreparedExportPanel {...options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare manual export' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The export could not be prepared. No file was produced.'));
    expect(screen.getByRole('button', { name: 'Prepare manual export' })).toHaveAttribute('aria-disabled', 'false');
    assertNoDisclosure();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Prepare manual export' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download summary.json' })).toBeInTheDocument());
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('It has not been delivered to the CFO');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it.each([401, 403, 500])('preserves the fixed presentation of readable HTTP %s', async status => {
    const port: FinanceV2SyntheticExportPort = { kind: FINANCE_V2_EXPORT_KIND, prepare: async () => { throw { status }; } };
    const { options } = fixture(port);
    const { result } = renderHook(() => usePreparedExport(options));
    act(() => result.current.prepare());
    await waitFor(() => expect(result.current.state).toEqual({ phase: 'failed', code: status === 401 ? 'unauthorized' : status === 403 ? 'FORBIDDEN_SCOPE' : 'failed' }));
    expect(result.current.download()).toBeNull();
  });
  it('contains an unreadable token rejection without calling the export port', async () => {
    const prepare = vi.fn(async () => prepared());
    const { options } = fixture({ kind: FINANCE_V2_EXPORT_KIND, prepare });
    render(<PreparedExportPanel {...options} authorization={{ revision: '1', token: async () => { throw revoked(); } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare manual export' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be prepared'));
    expect(prepare).not.toHaveBeenCalled();
    assertNoDisclosure();
  });
  it('does not inspect private exception fields', async () => {
    const readPrivate = vi.fn(() => { throw new Error(CANARY); });
    const error = Object.defineProperties({ status: 403 }, Object.fromEntries(['message', 'body', 'safe_message', 'diagnostic_ref', 'stack'].map(key => [key, { get: readPrivate }])));
    const { options } = fixture({ kind: FINANCE_V2_EXPORT_KIND, prepare: async () => { throw error; } });
    render(<PreparedExportPanel {...options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare manual export' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Export is not permitted'));
    expect(readPrivate).not.toHaveBeenCalled();
    assertNoDisclosure();
  });
  it('notices unreadable port metadata after a wait and retains the normal veto reason', async () => {
    let broken = false;
    const prepare = vi.fn(async () => { broken = true; return prepared(); });
    const port = { get kind() { if (broken) throw new Error(CANARY); return FINANCE_V2_EXPORT_KIND; }, prepare };
    const { options } = fixture(port);
    const { result } = renderHook(() => usePreparedExport(options));
    act(() => result.current.prepare());
    await waitFor(() => expect(result.current.unavailable).toBe('port-kind-mismatch'));
    expect(result.current.download()).toBeNull();
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('keeps a newly prepared export when a cancelled older request rejects unreadably', async () => {
    let rejectOld!: (reason: unknown) => void;
    let calls = 0;
    const port: FinanceV2SyntheticExportPort = { kind: FINANCE_V2_EXPORT_KIND, prepare: () => ++calls === 1 ? new Promise((_resolve, reject) => { rejectOld = reject; }) : Promise.resolve(prepared()) };
    const { host, options } = fixture(port);
    const { result, rerender } = renderHook((o: FinanceV2PreparedExportOptions) => usePreparedExport(o), { initialProps: options });
    act(() => result.current.prepare());
    await waitFor(() => expect(calls).toBe(1));
    host.current = { ...host.current, revision: '2' };
    rerender({ ...options, authorization: { ...options.authorization, revision: '2' } });
    act(() => result.current.prepare());
    await waitFor(() => expect(result.current.state.phase).toBe('prepared'));
    const inspect = vi.fn(() => { throw new Error(CANARY); });
    act(() => rejectOld(new Proxy({}, { getPrototypeOf: inspect, get: inspect })));
    await flush();
    expect(inspect).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe('prepared');
    expect(calls).toBe(2);
  });
  it('discards a valid answer when the host revokes export access during the request', async () => {
    const { host, options } = fixture(undefined);
    const prepare = vi.fn(async () => { host.current = { ...host.current, capabilities: [FINANCE_READ] }; return prepared(); });
    const configured = { ...options, port: { kind: FINANCE_V2_EXPORT_KIND, prepare } };
    const { result } = renderHook(() => usePreparedExport(configured));
    act(() => result.current.prepare());
    await waitFor(() => expect(result.current.unavailable).toBe('no-export-permission'));
    expect(result.current.download()).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
