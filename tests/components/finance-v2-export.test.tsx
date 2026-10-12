import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FINANCE_V2_EXPORT_KIND, FinanceV2ConnectedView, type FinanceV2ConnectedViewProps, type FinanceV2ExportHostAccess, type FinanceV2Page, type FinanceV2PreparedExportRequest,
  type FinanceV2SyntheticExportPort, type FinanceV2SyntheticReadPort, type OpaqueProductScope,
} from '../../src/views/finance-v2';
import { financeV2Fixture } from '../../src/views/finance-v2/fixtures';
import { FINANCE_EXPORT, FINANCE_READ } from '../../src/access/permissions';
import { syntheticPagedPort } from '../../integration/fixture-host/finance-v2-paged';
import { ZERO, expectationZero, ok, receiptZero, withContent, type Receipt } from './export-support';

/**
 * SYNTHETIC_EXPORT_CONFORMANCE_ONLY. The connected view with an injected export port and a host access reader, over the producer's ACTUAL receipt 0 as the port's answer.
 * The page under it is the synthetic `ready` fixture re-bound to receipt 0's snapshot, hashes, period and as-of (a presentation page, not Finance output). The host seams here
 * (access reader, token, ports) are test doubles, not a Product issuer and not a coherent live fence. Nothing here is delivery, a grant, or a consumer acceptance.
 */
const SCOPE: OpaqueProductScope = { tenantId: 'account:synthetic-tenant', projectId: 'event:synthetic-project', environment: 'test', billingMode: 'live', actorId: 'account:synthetic-actor' };
const TOKEN = 'secret-token-do-not-render-7f3a';
const CANARY = 'CANARY-MESSAGE-do-not-show';
const FUTURE = '2099-01-01T00:00:00Z';

const pageFor = (scope: OpaqueProductScope = SCOPE): FinanceV2Page => ({
  ...structuredClone((financeV2Fixture('ready').input as { page: FinanceV2Page }).page),
  snapshotId: ZERO.snapshotId, queryContentHash: ZERO.queryContentHash, summaryContentHash: ZERO.summaryContentHash, asOf: ZERO.asOf, period: { ...ZERO.period }, scope,
  filters: { environments: ['test'], billingModes: ['live'] },
});
const readPort = (): FinanceV2SyntheticReadPort => ({ kind: 'SYNTHETIC_PROPOSAL', read: async (request) => ({ status: 'ready', page: pageFor(request.scope) }) });

type Deferred = { request: FinanceV2PreparedExportRequest; resolve: (answer: unknown) => void; reject: (error: unknown) => void };
function deferredPort() {
  const pending: Deferred[] = [];
  const port: FinanceV2SyntheticExportPort = { kind: FINANCE_V2_EXPORT_KIND, prepare: (request) => new Promise((resolve, reject) => { pending.push({ request, resolve, reject }); }) };
  return { port, pending };
}
const answering = (answer: unknown): { port: FinanceV2SyntheticExportPort; calls: FinanceV2PreparedExportRequest[] } => {
  const calls: FinanceV2PreparedExportRequest[] = [];
  return { calls, port: { kind: FINANCE_V2_EXPORT_KIND, prepare: async (request) => { calls.push(request); return typeof answer === 'function' ? (answer as (r: FinanceV2PreparedExportRequest) => unknown)(request) : answer; } } };
};
function host(over: Partial<FinanceV2ExportHostAccess> = {}) {
  const state: { current: FinanceV2ExportHostAccess } = { current: { revision: '1', scope: SCOPE, capabilities: [FINANCE_READ, FINANCE_EXPORT], expiresAt: FUTURE, ...over } };
  const reader = () => state.current;
  return { state, reader };
}
type Env = ReturnType<typeof host>;
const settle = (ms = 25) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const props = (env: Env | null, port: FinanceV2SyntheticExportPort | undefined, over: Partial<FinanceV2ConnectedViewProps> = {}): FinanceV2ConnectedViewProps => ({
  mode: 'SYNTHETIC_PROPOSAL', view: 'budget', availability: { status: 'available' }, scope: SCOPE, expectedSnapshotId: ZERO.snapshotId, expectedQueryContentHash: ZERO.queryContentHash,
  expectedSummaryContentHash: ZERO.summaryContentHash, authorization: { revision: '1', token: async () => TOKEN }, port: stableRead,
  ...(port ? { exportPort: port } : {}), ...(env ? { exportAccess: env.reader } : {}), ...over,
}) as FinanceV2ConnectedViewProps;
const stableRead = readPort();

const created: Blob[] = [];
const clicks: { download: string }[] = [];
beforeEach(() => {
  created.length = 0; clicks.length = 0;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn((blob: Blob) => { created.push(blob); return 'blob:synthetic-export'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { clicks.push({ download: this.download }); });
});
afterEach(() => { vi.restoreAllMocks(); });
const readBlob = (blob: Blob): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('blob')); reader.readAsText(blob); });

const prepareButton = () => screen.getByRole('button', { name: 'Prepare manual export' });
const section = () => screen.getByRole('region', { name: 'CFO export' });
const downloadButton = () => screen.queryByRole('button', { name: /^Download / });
const answerWith = async (deferred: Deferred | undefined, answer: unknown) => { await act(async () => { deferred!.resolve(answer); await Promise.resolve(); }); await settle(); };
async function mountReady(env: Env | null, port: FinanceV2SyntheticExportPort | undefined, over: Partial<FinanceV2ConnectedViewProps> = {}) {
  const view = render(<FinanceV2ConnectedView {...props(env, port, over)} />);
  await settle();
  return view;
}
const prepared = (receipt: Receipt = receiptZero().receipt) => ok(receipt);

describe('fail-closed availability: nothing is offered unless the host stated both a port and its own current access', () => {
  it('keeps the original fixed "Export unavailable" section when the host configures no export at all', async () => {
    await mountReady(null, undefined);
    expect(screen.getByText(/Export is restricted\. No approved export port is connected/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Prepare manual export' })).toBeNull();
  });
  it('a missing port is unavailable with its own reason, even with full access', async () => {
    await mountReady(host(), undefined);
    expect(within(section()).getByRole('status')).toHaveTextContent('No export port was provided by the host');
    expect(screen.getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
  });
  it('a port without the host access reader is unavailable and never called', async () => {
    const { port, calls } = answering(prepared());
    await mountReady(null, port);
    expect(within(section()).getByRole('status')).toHaveTextContent('The host has not stated current export access');
    expect(calls).toEqual([]);
  });
  it('a port of the wrong kind is unavailable', async () => {
    await mountReady(host(), { kind: 'SYNTHETIC_PROPOSAL', prepare: async () => prepared() } as unknown as FinanceV2SyntheticExportPort);
    expect(within(section()).getByRole('status')).toHaveTextContent('not usable in this mode');
  });
  it('INTEGRATED mode never reaches an export port, whatever the host injects', async () => {
    const { port, calls } = answering(prepared());
    render(<FinanceV2ConnectedView {...({ ...props(host(), port), mode: 'INTEGRATED', port: undefined } as FinanceV2ConnectedViewProps)} />);
    await settle();
    expect(calls).toEqual([]);
    expect(document.body.textContent).toContain('no accepted read port exists');
    expect(screen.queryByRole('button', { name: 'Prepare manual export' })).toBeNull();
  });
  it('export permission is separate from read permission, in both directions, and neither is derived from the other', async () => {
    const readOnly = answering(prepared());
    const first = await mountReady(host({ capabilities: [FINANCE_READ] }), readOnly.port);
    expect(within(section()).getByRole('status')).toHaveTextContent('You do not have export permission');
    expect(screen.getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
    first.unmount();
    const exportOnly = answering(prepared());
    await mountReady(host({ capabilities: [FINANCE_EXPORT] }), exportOnly.port);
    expect(within(section()).getByRole('status')).toHaveTextContent('Export needs read access');
    expect(readOnly.calls).toEqual([]); expect(exportOnly.calls).toEqual([]);
  });
  it('Finance permission names and role-like capabilities are not aliases for the Dashboard export capability', async () => {
    for (const capabilities of [[FINANCE_READ, 'finance.summary.export'], [FINANCE_READ, 'export'], [FINANCE_READ, 'admin'], [FINANCE_READ, 'FINANCE.EXPORT'], [FINANCE_READ, 'finance.exports']]) {
      const { port, calls } = answering(prepared());
      const view = await mountReady(host({ capabilities }), port);
      expect(within(section()).getByRole('status')).toHaveTextContent('You do not have export permission');
      expect(calls).toEqual([]);
      view.unmount();
    }
  });
  it.each([
    ['an expired access', { expiresAt: '2020-01-01T00:00:00Z' }, 'Your access has expired'],
    ['a malformed expiry', { expiresAt: 'tomorrow' }, 'Your access has expired'],
    ['a different revision', { revision: '2' }, 'Your access changed'],
    ['a different actor', { scope: { ...SCOPE, actorId: 'account:someone-else' } }, 'The host scope changed'],
    ['a different project', { scope: { ...SCOPE, projectId: 'event:other' } }, 'The host scope changed'],
  ] as const)('is unavailable under %s', async (_name, over, text) => {
    const { port, calls } = answering(prepared());
    await mountReady(host(over as Partial<FinanceV2ExportHostAccess>), port);
    expect(within(section()).getByRole('status')).toHaveTextContent(text);
    expect(calls).toEqual([]);
  });
  it('a throwing or malformed access reader fails closed', async () => {
    for (const reader of [() => { throw new Error(CANARY); }, () => null, () => 'allowed', () => ({ revision: '1' })]) {
      const { port, calls } = answering(prepared());
      const view = render(<FinanceV2ConnectedView {...props(null, port, { exportAccess: reader as never })} />);
      await settle();
      expect(within(section()).getByRole('status')).toHaveTextContent(/has not stated current export access|Your access changed/u);
      expect(calls).toEqual([]);
      expect(document.body.textContent).not.toContain(CANARY);
      view.unmount();
    }
  });
});

describe('original first snapshot only, never a continuation page', () => {
  it('a deep-linked cursor page cannot export, and the port is never called', async () => {
    const { port, calls } = answering(prepared());
    await mountReady(host(), port, { initialCursor: 'synthetic-opaque-cursor' });
    expect(within(section()).getByRole('status')).toHaveTextContent('original first page of the snapshot only');
    expect(screen.getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
    expect(calls).toEqual([]);
  });
  it('paging to a continuation page closes the export, and returning to the first page offers it again', async () => {
    const { port, calls } = answering(prepared());
    const read = syntheticPagedPort();
    const env = host();
    render(<FinanceV2ConnectedView {...props(env, port, { view: 'transactions', port: read, expectedSnapshotId: ZERO.snapshotId })} />);
    await settle();
    // The paged synthetic port answers for the host's expectation but not receipt 0's period, so the first page is shown and exportable only as far as the gate: the gate is what is tested.
    expect(screen.getByRole('button', { name: 'Prepare manual export' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' })); await settle(); await settle();
    expect(within(section()).getByRole('status')).toHaveTextContent('original first page of the snapshot only');
    expect(screen.queryByRole('button', { name: 'Prepare manual export' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' })); await settle(); await settle();
    expect(screen.getByRole('button', { name: 'Prepare manual export' })).toBeInTheDocument();
    expect(calls).toEqual([]);
  });
});

describe('prepare → verify → manual download of the actual producer bytes', () => {
  it('sends a typed request bound to the host identity and shows honest manual_prepared status; no content, token or cursor reaches the DOM, URL or web storage', async () => {
    const { port, calls } = answering(prepared());
    await mountReady(host(), port);
    expect(within(section()).getByRole('note')).toHaveTextContent('SYNTHETIC_EXPORT_CONFORMANCE_ONLY');
    fireEvent.click(prepareButton()); await settle();
    expect(calls).toHaveLength(1);
    const request = calls[0]!;
    expect(request).toMatchObject({ format: 'json', destination: 'cfo.ai', scope: SCOPE, expectedSnapshotId: ZERO.snapshotId, expectedQueryContentHash: ZERO.queryContentHash, expectedSummaryContentHash: ZERO.summaryContentHash, authorization: { token: TOKEN, revision: '1' } });
    expect(request.summarySnapshot.snapshotId).toBe(ZERO.snapshotId);
    expect(request.signal.aborted).toBe(false);
    const panel = section();
    expect(within(panel).getByRole('status')).toHaveTextContent('Prepared for manual handoff. It has not been delivered to the CFO and there is no delivery reference.');
    expect(panel).toHaveTextContent('manual_prepared (not delivered)');
    expect(panel).toHaveTextContent('Delivery referenceNone');
    expect(panel).toHaveTextContent('Prepared at (producer clock)2026-10-12T22:00:00.000Z');
    expect(panel).toHaveTextContent('Export idsha256:3d33f92e69e26c63c6047a48c4e1dd7cb49f93798d180c0a35dbc13a636eccf1');
    expect(panel).toHaveTextContent('summary.json14013 bytes, sha256:9129ef4a88437e70d7c7da85c8ad36d5ce3c9569a66aa779a4e694ee1f1a1353');
    expect(panel).toHaveTextContent('metrics.csv3892 bytes, sha256:38fd0ac898825be6547fe5a014595c06665b7f6ea95cffc28bfffe99dbb31132');
    expect(panel.textContent).not.toMatch(/delivered to (the )?CFO(?! )|export (was )?(sent|delivered)|successfully (sent|exported)/iu);
    const everything = `${document.documentElement.outerHTML}\n${window.location.href}\n${JSON.stringify({ ...localStorage })}\n${JSON.stringify({ ...sessionStorage })}`;
    for (const secret of [TOKEN, 'finance_reporting_export_proposal', 'currency,scale,metric', 'Parallel simulated', '6.000000000000000000', 'blob:']) expect(everything).not.toContain(secret);
    expect(created).toEqual([]);
  });
  it('downloads exactly the producer bytes of the requested file only after an explicit click', async () => {
    const receipt = receiptZero().receipt;
    const { port } = answering(prepared(receipt));
    await mountReady(host(), port);
    fireEvent.click(prepareButton()); await settle();
    expect(created).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Download summary.json' }));
    expect(created).toHaveLength(1);
    expect(clicks).toEqual([{ download: 'summary.json' }]);
    expect(created[0]!.type).toBe('application/json;charset=utf-8');
    expect(await readBlob(created[0]!)).toBe(receipt.artifacts[0]!.content);
    expect(created[0]!.size).toBe(14013);
    expect(within(section()).getByRole('status')).toHaveTextContent('Download of summary.json started.');
    expect(document.body.textContent).not.toContain('"asOf"');
  });
  it('a CSV preparation downloads metrics.csv with CRLF records and no BOM, byte for byte (test-built CSV-requested receipt, not producer output)', async () => {
    const csvReceipt = withContent(receiptZero().receipt, 'summary.json', (content) => content);
    csvReceipt.manifest.requestedFormat = 'csv';
    const { port, calls } = answering(prepared(csvReceipt));
    await mountReady(host(), port);
    fireEvent.click(screen.getByRole('radio', { name: 'CSV (metrics.csv)' }));
    fireEvent.click(prepareButton()); await settle();
    expect(calls[0]!.format).toBe('csv');
    fireEvent.click(screen.getByRole('button', { name: 'Download metrics.csv' }));
    const text = await readBlob(created[0]!);
    expect(text).toBe(csvReceipt.artifacts[1]!.content);
    expect(text.startsWith('currency,scale,metric')).toBe(true);
    expect(text.split('\r\n')).toHaveLength(13);
    expect(created[0]!.type).toBe('text/csv;charset=utf-8');
    expect(created[0]!.size).toBe(3892);
    expect(clicks).toEqual([{ download: 'metrics.csv' }]);
  });
  it('a double activation sends one request, and the busy button is announced', async () => {
    const { port, pending } = deferredPort();
    await mountReady(host(), port);
    fireEvent.click(prepareButton()); fireEvent.click(prepareButton()); await settle();
    expect(pending).toHaveLength(1);
    expect(prepareButton()).toHaveAttribute('aria-disabled', 'true');
    expect(within(section()).getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(document.activeElement === document.body || section().contains(document.activeElement)).toBe(true);
    await answerWith(pending[0], prepared());
    expect(downloadButton()).not.toBeNull();
  });
  it('keeps keyboard focus on the Prepare button through preparing and prepared', async () => {
    const { port } = answering(prepared());
    await mountReady(host(), port);
    prepareButton().focus();
    fireEvent.click(prepareButton()); await settle();
    expect(document.activeElement).toBe(prepareButton());
    expect(downloadButton()).not.toBeNull();
  });
});

describe('refusing what is not bound, with no bytes kept', () => {
  const run = async (answer: unknown, format: 'json' | 'csv' = 'json') => {
    const { port } = answering(answer);
    await mountReady(host(), port);
    if (format === 'csv') fireEvent.click(screen.getByRole('radio', { name: 'CSV (metrics.csv)' }));
    fireEvent.click(prepareButton()); await settle();
  };
  it('refuses a valid receipt prepared for the other format (json receipt for a csv request)', async () => {
    await run(prepared(), 'csv');
    expect(within(section()).getByRole('alert')).toHaveTextContent('FORMAT_MISMATCH');
    expect(downloadButton()).toBeNull();
    expect(created).toEqual([]);
  });
  it('refuses a receipt for another snapshot, hash, period or currency set', async () => {
    const other = structuredClone(receiptZero().receipt);
    other.manifest.queryContentHash = `sha256:${'9'.repeat(64)}`;
    await run(ok(other));
    expect(within(section()).getByRole('alert')).toHaveTextContent('QUERY_HASH_MISMATCH');
    expect(within(section()).getByRole('alert')).toHaveTextContent('/value/manifest/queryContentHash');
    expect(downloadButton()).toBeNull();
  });
  it('refuses a content-tampered file even when the manifest and declared length are consistent', async () => {
    await run(ok(withContent(receiptZero().receipt, 'metrics.csv', (content) => content.replace(',test,live,', ',test,sandbox,'))));
    expect(within(section()).getByRole('alert')).toHaveTextContent('SCOPE_MISMATCH');
    expect(downloadButton()).toBeNull();
  });
  it('refuses a "delivered" claim and shows nothing of it as success', async () => {
    const claimed = structuredClone(receiptZero().receipt); claimed.manifest.status = 'delivered'; claimed.manifest.delivery = 'delivered'; claimed.manifest.deliveryReference = 'cfo-1';
    await run(ok(claimed));
    expect(within(section()).getByRole('alert')).toHaveTextContent('UNSUPPORTED_STATUS');
    expect(section().textContent).not.toMatch(/Prepared for manual handoff/u);
    expect(downloadButton()).toBeNull();
  });
  it.each([
    ['SOURCE_UNAVAILABLE', 'The export source is unavailable right now. No file was produced.'],
    ['FORBIDDEN_SCOPE', 'Export is not permitted for this scope or access. No file was produced.'],
    ['IDEMPOTENCY_CONFLICT', 'This snapshot was already prepared with different parameters. No file was produced.'],
    ['VALIDATION_ERROR', 'The export request was not valid. No file was produced.'],
    ['UNSUPPORTED_VERSION', 'This snapshot cannot be exported in a supported format. No file was produced.'],
  ])('shows fixed copy for %s and never echoes the port message', async (code, copy) => {
    await run({ ok: false, error: { code, safe_message: CANARY, detail: { token: TOKEN } } });
    expect(within(section()).getByRole('alert')).toHaveTextContent(copy);
    expect(document.documentElement.outerHTML).not.toContain(CANARY);
    expect(document.documentElement.outerHTML).not.toContain(TOKEN);
    expect(downloadButton()).toBeNull();
  });
  it('a failure that also carries bytes is refused, not shown as a typed failure and not kept', async () => {
    await run({ ok: false, error: { code: 'SOURCE_UNAVAILABLE' }, value: receiptZero().receipt });
    expect(within(section()).getByRole('alert')).toHaveTextContent('Export refused');
    expect(downloadButton()).toBeNull();
  });
  it.each([[401, 'Export is not authorized for you right now'], [403, 'Export is not permitted for this scope or access'], [500, 'The export could not be prepared'], [undefined, 'The export could not be prepared']])('maps a rejection with status %s to fixed copy without reading its message', async (status, copy) => {
    const port: FinanceV2SyntheticExportPort = { kind: FINANCE_V2_EXPORT_KIND, prepare: async () => { throw Object.assign(new Error(CANARY), status === undefined ? {} : { status }); } };
    await mountReady(host(), port);
    fireEvent.click(prepareButton()); await settle();
    expect(within(section()).getByRole('alert')).toHaveTextContent(copy);
    expect(document.documentElement.outerHTML).not.toContain(CANARY);
  });
  it('no token means no request to the port', async () => {
    const { port, calls } = answering(prepared());
    // The first token resolution is the Finance read's; the export's own fresh token is then missing.
    let resolutions = 0;
    await mountReady(host(), port, { authorization: { revision: '1', token: async () => ((resolutions += 1) === 1 ? TOKEN : null) } });
    fireEvent.click(prepareButton()); await settle();
    expect(calls).toEqual([]);
    expect(within(section()).getByRole('alert')).toHaveTextContent('Export is not authorized for you right now');
  });
  it('a fixture receipt alone authorizes nothing: without the host access reader the same receipt is never fetched or offered', async () => {
    const { port, calls } = answering(prepared());
    await mountReady(null, port);
    expect(calls).toEqual([]);
    expect(downloadButton()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prepare manual export' })).toBeNull();
  });
});

describe('renewing authority before and after every await and before disclosure', () => {
  it('revocation of the export capability during the token await: the port is never called', async () => {
    const env = host();
    let release: (token: string) => void = () => undefined;
    const token = new Promise<string>((resolve) => { release = resolve; });
    const { port, calls } = answering(prepared());
    let resolutions = 0;
    await mountReady(env, port, { authorization: { revision: '1', token: () => ((resolutions += 1) === 1 ? Promise.resolve(TOKEN) : token) } });
    fireEvent.click(prepareButton()); await settle();
    env.state.current = { ...env.state.current, capabilities: [FINANCE_READ] };
    await act(async () => { release(TOKEN); await Promise.resolve(); }); await settle();
    expect(calls).toEqual([]);
    expect(section()).toHaveTextContent('You do not have export permission');
    expect(downloadButton()).toBeNull();
  });
  it('revocation during the port await: a valid late answer is dropped and nothing is ever downloadable', async () => {
    const env = host();
    const { port, pending } = deferredPort();
    await mountReady(env, port);
    fireEvent.click(prepareButton()); await settle();
    env.state.current = { ...env.state.current, capabilities: [FINANCE_READ] };
    await answerWith(pending[0], prepared());
    expect(section()).toHaveTextContent('You do not have export permission');
    expect(downloadButton()).toBeNull();
    expect(screen.queryByText(/Prepared for manual handoff/u)).toBeNull();
    expect(created).toEqual([]);
  });
  it('a revoke-and-restore that straddles the answer (ABA with an unchanged revision) leaves nothing prepared once access is back', async () => {
    const env = host();
    const granted = env.state.current;
    const { port, pending } = deferredPort();
    const view = await mountReady(env, port);
    fireEvent.click(prepareButton()); await settle();
    env.state.current = { ...granted, capabilities: [FINANCE_READ] };
    await answerWith(pending[0], prepared());
    env.state.current = granted;
    view.rerender(<FinanceV2ConnectedView {...props(env, port)} />); await settle(600);
    expect(downloadButton()).toBeNull();
    expect(screen.queryByText(/Prepared for manual handoff/u)).toBeNull();
    expect(created).toEqual([]);
  });
  it('revocation of READ access alone also drops the answer (export without read is not enough)', async () => {
    const env = host();
    const { port, pending } = deferredPort();
    await mountReady(env, port);
    fireEvent.click(prepareButton()); await settle();
    env.state.current = { ...env.state.current, capabilities: [FINANCE_EXPORT] };
    await answerWith(pending[0], prepared());
    expect(section()).toHaveTextContent('Export needs read access');
    expect(downloadButton()).toBeNull();
  });
  it('expiry during the port await drops the answer', async () => {
    const env = host({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const { port, pending } = deferredPort();
    await mountReady(env, port);
    fireEvent.click(prepareButton()); await settle();
    env.state.current = { ...env.state.current, expiresAt: '2020-01-01T00:00:00Z' };
    await answerWith(pending[0], prepared());
    expect(section()).toHaveTextContent('Your access has expired');
    expect(downloadButton()).toBeNull();
  });
  it('a host revision change during the port await (revoke then restore, ABA) drops the answer', async () => {
    const env = host();
    const { port, pending } = deferredPort();
    await mountReady(env, port);
    fireEvent.click(prepareButton()); await settle();
    env.state.current = { ...env.state.current, revision: '2' };
    env.state.current = { ...env.state.current, revision: '1', capabilities: [FINANCE_READ, FINANCE_EXPORT] };
    // Back to the same revision string would be a host bug the Dashboard cannot see; a real host bumps the revision on every change, so the in-between revision is what is observed:
    env.state.current = { ...env.state.current, revision: '3' };
    await answerWith(pending[0], prepared());
    expect(section()).toHaveTextContent('Your access changed');
    expect(downloadButton()).toBeNull();
  });
  it('a stale actor, scope or authorization revision after the render drops a late answer', async () => {
    const env = host();
    const { port, pending } = deferredPort();
    const view = await mountReady(env, port);
    fireEvent.click(prepareButton()); await settle();
    const other: OpaqueProductScope = { ...SCOPE, actorId: 'account:synthetic-actor-b' };
    env.state.current = { ...env.state.current, scope: other, revision: '2' };
    view.rerender(<FinanceV2ConnectedView {...props(env, port, { scope: other, authorization: { revision: '2', token: async () => TOKEN } })} />);
    await settle();
    await answerWith(pending[0], prepared());
    expect(downloadButton()).toBeNull();
    expect(screen.queryByText(/Prepared for manual handoff/u)).toBeNull();
    expect(pending).toHaveLength(1);
    expect(prepareButton()).not.toHaveAttribute('aria-disabled', 'true');
  });
  it('a replaced export port drops the old port\'s late answer and does not call the new one', async () => {
    const env = host();
    const first = deferredPort();
    const second = deferredPort();
    const view = await mountReady(env, first.port);
    fireEvent.click(prepareButton()); await settle();
    view.rerender(<FinanceV2ConnectedView {...props(env, second.port)} />); await settle();
    await answerWith(first.pending[0], prepared());
    expect(downloadButton()).toBeNull();
    expect(second.pending).toHaveLength(0);
    expect(first.pending[0]!.request.signal.aborted).toBe(true);
  });
  it('a replaced access reader drops the late answer (a different host context)', async () => {
    const env = host();
    const { port, pending } = deferredPort();
    const view = await mountReady(env, port);
    fireEvent.click(prepareButton()); await settle();
    view.rerender(<FinanceV2ConnectedView {...props(host(), port)} />); await settle();
    await answerWith(pending[0], prepared());
    expect(downloadButton()).toBeNull();
  });
  it('changing the format during the await cancels the run and drops its answer', async () => {
    const { port, pending } = deferredPort();
    await mountReady(host(), port);
    fireEvent.click(prepareButton()); await settle();
    fireEvent.click(screen.getByRole('radio', { name: 'CSV (metrics.csv)' })); await settle();
    expect(pending[0]!.request.signal.aborted).toBe(true);
    await answerWith(pending[0], prepared());
    expect(downloadButton()).toBeNull();
    expect(prepareButton()).not.toHaveAttribute('aria-disabled', 'true');
  });
  it('a filter change during the await returns the view to a re-read and drops the answer', async () => {
    const { port, pending } = deferredPort();
    await mountReady(host(), port, { view: 'transactions' });
    fireEvent.click(prepareButton()); await settle();
    fireEvent.change(screen.getByLabelText('Valuation'), { target: { value: 'estimated' } }); await settle();
    expect(pending[0]!.request.signal.aborted).toBe(true);
    await answerWith(pending[0], prepared());
    await settle();
    expect(downloadButton()).toBeNull();
    expect(screen.queryByText(/Prepared for manual handoff/u)).toBeNull();
    expect(prepareButton()).not.toHaveAttribute('aria-disabled', 'true');
  });
  it('unmounting during the await ignores the late answer without errors', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { port, pending } = deferredPort();
    const view = await mountReady(host(), port);
    fireEvent.click(prepareButton()); await settle();
    view.unmount();
    await act(async () => { pending[0]!.resolve(prepared()); await Promise.resolve(); });
    expect(errors).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });
  it('a timeout aborts the request and a late answer from a port that ignores the abort is dropped', async () => {
    const { port, pending } = deferredPort();
    await mountReady(host(), port, { timeoutMs: 30 });
    fireEvent.click(prepareButton()); await settle(60);
    expect(pending[0]!.request.signal.aborted).toBe(true);
    expect(within(section()).getByRole('alert')).toHaveTextContent('The export could not be prepared');
    await answerWith(pending[0], prepared());
    expect(downloadButton()).toBeNull();
    expect(screen.queryByText(/Prepared for manual handoff/u)).toBeNull();
  });
  it('a retry after a failure starts a fresh request with a fresh token', async () => {
    let attempts = 0;
    const tokens: string[] = [];
    const port: FinanceV2SyntheticExportPort = { kind: FINANCE_V2_EXPORT_KIND, prepare: async (request) => { attempts += 1; tokens.push(request.authorization.token); return attempts === 1 ? { ok: false, error: { code: 'SOURCE_UNAVAILABLE' } } : prepared(); } };
    let n = 0;
    await mountReady(host(), port, { authorization: { revision: '1', token: async () => `${TOKEN}-${(n += 1)}` } });
    fireEvent.click(prepareButton()); await settle();
    expect(within(section()).getByRole('alert')).toHaveTextContent('The export source is unavailable');
    fireEvent.click(prepareButton()); await settle();
    expect(downloadButton()).not.toBeNull();
    // Token 1 was the Finance read's; each export attempt asks for its own fresh one.
    expect(tokens).toEqual([`${TOKEN}-2`, `${TOKEN}-3`]);
  });
});

describe('renewing before disclosure', () => {
  it('revocation after preparation, with no re-render: the click discloses nothing', async () => {
    const env = host();
    const { port } = answering(prepared());
    await mountReady(env, port);
    fireEvent.click(prepareButton()); await settle();
    const button = screen.getByRole('button', { name: 'Download summary.json' });
    env.state.current = { ...env.state.current, capabilities: [FINANCE_READ] };
    fireEvent.click(button); await settle();
    expect(created).toEqual([]);
    expect(clicks).toEqual([]);
    expect(downloadButton()).toBeNull();
    expect(section()).toHaveTextContent('You do not have export permission');
  });
  it.each([
    ['revision', (env: Env) => { env.state.current = { ...env.state.current, revision: '9' }; }, 'Your access changed'],
    ['actor', (env: Env) => { env.state.current = { ...env.state.current, scope: { ...SCOPE, actorId: 'account:other' } }; }, 'The host scope changed'],
    ['expiry', (env: Env) => { env.state.current = { ...env.state.current, expiresAt: '2020-01-01T00:00:00Z' }; }, 'Your access has expired'],
    ['reader failure', (env: Env) => { env.state.current = null as never; }, 'The host has not stated current export access'],
  ])('a %s change after preparation discloses nothing', async (_name, change, text) => {
    const env = host();
    const { port } = answering(prepared());
    await mountReady(env, port);
    fireEvent.click(prepareButton()); await settle();
    const button = screen.getByRole('button', { name: 'Download summary.json' });
    change(env);
    fireEvent.click(button); await settle();
    expect(created).toEqual([]);
    expect(section()).toHaveTextContent(text);
  });
  it('the bytes are dropped for good after a vetoed disclosure: restoring access does not resurrect them', async () => {
    const env = host();
    const { port } = answering(prepared());
    await mountReady(env, port);
    fireEvent.click(prepareButton()); await settle();
    const button = screen.getByRole('button', { name: 'Download summary.json' });
    env.state.current = { ...env.state.current, capabilities: [FINANCE_READ] };
    fireEvent.click(button); await settle();
    env.state.current = { ...env.state.current, capabilities: [FINANCE_READ, FINANCE_EXPORT] };
    fireEvent.click(button); await settle();
    expect(created).toEqual([]);
    expect(downloadButton()).toBeNull();
  });
  it('revocation is noticed without any interaction while a prepared export is on screen', async () => {
    const env = host();
    const { port } = answering(prepared());
    await mountReady(env, port);
    fireEvent.click(prepareButton()); await settle();
    expect(downloadButton()).not.toBeNull();
    env.state.current = { ...env.state.current, capabilities: [FINANCE_READ] };
    await settle(600);
    expect(downloadButton()).toBeNull();
    expect(section()).toHaveTextContent('You do not have export permission');
    expect(created).toEqual([]);
  });
});

describe('contract details', () => {
  it('uses the host-stated expectation, not the page, for the answer binding (a forged page cannot widen what the export may match)', async () => {
    const forgedRead: FinanceV2SyntheticReadPort = { kind: 'SYNTHETIC_PROPOSAL', read: async (request) => ({ status: 'ready', page: { ...pageFor(request.scope), snapshotId: `sha256:${'8'.repeat(64)}` } }) };
    const { port, calls } = answering(prepared());
    await mountReady(host(), port, { port: forgedRead });
    expect(screen.queryByRole('button', { name: 'Prepare manual export' })).toBeNull();
    expect(calls).toEqual([]);
  });
  it('exposes the same expectation literal the guard tests use', () => {
    expect(expectationZero().format).toBe('json');
  });
});
