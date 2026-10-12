import { readFileSync } from 'node:fs';
import { useMemo, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dashboard } from '../../src';
import {
  FinanceV2ConnectedView, classifyFinanceV2Fault, resolveFinanceV2Port, FINANCE_V2_PAGINATION,
  type FinanceV2ConnectedViewProps, type FinanceV2ReadRequest, type FinanceV2SyntheticReadPort,
} from '../../src/views/finance-v2';
import { financeV2Fixture, syntheticOpaqueScope, syntheticQueryContentHash, syntheticSnapshotId, syntheticSummaryContentHash, detailIds } from '../../src/views/finance-v2/fixtures';
import { authorizedFixture, fixtureProvider } from '../../integration/fixture-host/host';

type Page = Record<string, unknown>;
const readyPage = (): Page => structuredClone((financeV2Fixture('ready').input as { page: Page }).page);
/** A page for exactly the request, tagged so a stale answer is recognisable on screen (the Request row). */
const pageFor = (request: FinanceV2ReadRequest, tag: string, over: Page = {}): Page => ({ ...readyPage(), scope: request.scope, requestId: tag, ...over });

type Pending = { request: FinanceV2ReadRequest; resolve: (value: Awaited<ReturnType<FinanceV2SyntheticReadPort['read']>>) => void; reject: (error: unknown) => void };
/** A port that answers only when the test says so, and that deliberately ignores `request.signal`. */
function manualPort() {
  const pending: Pending[] = [];
  const port: FinanceV2SyntheticReadPort = { kind: 'SYNTHETIC_PROPOSAL', read: (request) => new Promise((resolve, reject) => { pending.push({ request, resolve, reject }); }) };
  return { port, pending };
}
const authorization = (revision = '1', token: string | null = 'opaque-token-1') => ({ revision, token: async () => token });
function connected(port: FinanceV2SyntheticReadPort | undefined, over: Partial<FinanceV2ConnectedViewProps> = {}): FinanceV2ConnectedViewProps {
  return {
    mode: 'SYNTHETIC_PROPOSAL', view: 'budget', availability: { status: 'available' }, scope: syntheticOpaqueScope, expectedSnapshotId: syntheticSnapshotId,
    expectedQueryContentHash: syntheticQueryContentHash, expectedSummaryContentHash: syntheticSummaryContentHash, authorization: authorization(), ...(port ? { port } : {}), ...over,
  } as FinanceV2ConnectedViewProps;
}
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const request = (pending: Pending[], index: number) => pending[index]!.request;
const amountsShown = () => screen.queryAllByText(/\d\.0{18}/u).length > 0;

describe('port resolution: integrated mode can never reach a port or a fixture', () => {
  const synthetic: FinanceV2SyntheticReadPort = { kind: 'SYNTHETIC_PROPOSAL', read: async () => ({ status: 'missing' }) };
  it('resolves a declared synthetic port only in SYNTHETIC_PROPOSAL mode', () => {
    expect(resolveFinanceV2Port('SYNTHETIC_PROPOSAL', synthetic)).toEqual({ status: 'available', port: synthetic });
    expect(resolveFinanceV2Port('INTEGRATED', synthetic)).toEqual({ status: 'unavailable', reason: 'integrated-port-not-accepted' });
    expect(resolveFinanceV2Port('INTEGRATED', undefined)).toEqual({ status: 'unavailable', reason: 'integrated-port-not-accepted' });
  });
  it.each([[undefined, 'no-port'], [null, 'no-port'], [{ read: async () => ({ status: 'missing' }) }, 'port-kind-mismatch'], [{ kind: 'ACCEPTED', read: async () => ({ status: 'missing' }) }, 'port-kind-mismatch'], [{ kind: 'SYNTHETIC_PROPOSAL' }, 'port-kind-mismatch'], ['port', 'port-kind-mismatch']])('refuses %j as %s', (value, reason) => {
    expect(resolveFinanceV2Port('SYNTHETIC_PROPOSAL', value)).toEqual({ status: 'unavailable', reason });
  });
  it('renders INTEGRATED unavailable, calls nothing, and shows no amount even when a synthetic port is smuggled in', async () => {
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...({ ...connected(port), mode: 'INTEGRATED' } as FinanceV2ConnectedViewProps)} />);
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent('no accepted read port exists');
    expect(pending).toHaveLength(0);
    expect(amountsShown()).toBe(false);
    expect(screen.queryByText(/SYNTHETIC_PROPOSAL/u)).toBeNull();
  });
  it('renders SYNTHETIC mode without a port unavailable, with no fixture substituted', async () => {
    render(<FinanceV2ConnectedView {...connected(undefined)} />);
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent('No Finance v2 read port was provided');
    expect(amountsShown()).toBe(false);
  });
  it('keeps fixtures, hashing, downloads and cursors out of the port and connected sources', () => {
    for (const file of ['async-port.ts', 'FinanceV2ConnectedView.tsx']) {
      // Comments may name what the code does not do; only executable text is checked.
      const source = readFileSync(`${process.cwd()}/src/views/finance-v2/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
      expect(source).not.toMatch(/fixtures|crypto|subtle|createObjectURL|\bBlob\b|download|cursor|nextCursor|localStorage|sessionStorage|location\.(search|href)/iu);
      expect(source).not.toMatch(/\b(?:parseFloat|parseInt|Number|BigInt|Decimal)\(/u);
    }
  });
  it('states that pagination is unsupported', () => { expect(FINANCE_V2_PAGINATION).toBe('unsupported'); });
});

describe('request contract', () => {
  it('asks for exactly the host-stated identity with the current token, revision and an abort signal, and no cursor', async () => {
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port, { authorization: authorization('7', 'opaque-token-7') })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the report');
    await settle();
    expect(pending).toHaveLength(1);
    const asked = request(pending, 0);
    expect(asked.scope).toEqual(syntheticOpaqueScope);
    expect(asked.expectedSnapshotId).toBe(syntheticSnapshotId);
    expect(asked.expectedQueryContentHash).toBe(syntheticQueryContentHash);
    expect(asked.expectedSummaryContentHash).toBe(syntheticSummaryContentHash);
    expect(asked.authorization).toEqual({ token: 'opaque-token-7', revision: '7' });
    expect(asked.signal.aborted).toBe(false);
    expect(Object.keys(asked).sort()).toEqual(['authorization', 'expectedQueryContentHash', 'expectedSnapshotId', 'expectedSummaryContentHash', 'scope', 'signal']);
    await act(async () => pending[0]!.resolve({ status: 'ready', page: pageFor(asked, 'req-A') }));
    expect(await screen.findByRole('region', { name: 'Budget advisory' })).toBeVisible();
    expect(document.body.textContent).not.toContain('opaque-token-7');
    expect(document.body.textContent).toContain('req-A');
  });
  it('shows no amount while loading', async () => {
    const { port } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(amountsShown()).toBe(false);
  });
});

describe('late responses are suppressed when the independent identity changes', () => {
  const changes: readonly (readonly [string, Partial<FinanceV2ConnectedViewProps>])[] = [
    ['actor', { scope: { ...syntheticOpaqueScope, actorId: 'account:another-actor' } }],
    ['tenant', { scope: { ...syntheticOpaqueScope, tenantId: 'account:another-tenant' } }],
    ['project', { scope: { ...syntheticOpaqueScope, projectId: 'event:another-project' } }],
    ['environment', { scope: { ...syntheticOpaqueScope, environment: 'live' } }],
    ['billing mode', { scope: { ...syntheticOpaqueScope, billingMode: 'live' } }],
    ['authorization revision', { authorization: authorization('2') }],
    ['expected snapshot', { expectedSnapshotId: `sha256:${'a'.repeat(64)}` }],
    ['expected query hash', { expectedQueryContentHash: `sha256:${'b'.repeat(64)}` }],
    ['expected summary hash', { expectedSummaryContentHash: `sha256:${'c'.repeat(64)}` }],
  ];
  it.each(changes)('drops the old answer after a %s change, even though the port ignored the abort', async (_name, change) => {
    const { port, pending } = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    const old = request(pending, 0);
    view.rerender(<FinanceV2ConnectedView {...connected(port, change)} />);
    expect(old.signal.aborted).toBe(true);
    // Synchronously after the change nothing from the old identity is shown; the new request is loading.
    expect(screen.getByRole('status')).toHaveTextContent('Loading the report');
    await settle();
    expect(pending).toHaveLength(2);
    await act(async () => pending[0]!.resolve({ status: 'ready', page: pageFor(old, 'STALE-OLD') }));
    expect(document.body.textContent).not.toContain('STALE-OLD');
    expect(amountsShown()).toBe(false);
    const fresh = request(pending, 1);
    const newScope = (change as { scope?: unknown }).scope ?? syntheticOpaqueScope;
    expect(fresh.scope).toEqual(newScope);
    // The new request's answer must satisfy the NEW identity: here it is built for the old snapshot/hashes only when those did not change.
    const over: Page = { ...(change.expectedSnapshotId ? { snapshotId: change.expectedSnapshotId } : {}), ...(change.expectedQueryContentHash ? { queryContentHash: change.expectedQueryContentHash } : {}), ...(change.expectedSummaryContentHash ? { summaryContentHash: change.expectedSummaryContentHash } : {}) };
    await act(async () => pending[1]!.resolve({ status: 'ready', page: pageFor(fresh, 'FRESH-NEW', over) }));
    expect(await screen.findByRole('region', { name: 'Budget advisory' })).toBeVisible();
    expect(document.body.textContent).toContain('FRESH-NEW');
    expect(document.body.textContent).not.toContain('STALE-OLD');
  });
  it('does not show the previous answer for a frame when the identity changes after settling', async () => {
    const { port, pending } = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    await act(async () => pending[0]!.resolve({ status: 'ready', page: pageFor(request(pending, 0), 'ANSWER-1') }));
    expect(document.body.textContent).toContain('ANSWER-1');
    view.rerender(<FinanceV2ConnectedView {...connected(port, { authorization: authorization('2') })} />);
    expect(document.body.textContent).not.toContain('ANSWER-1');
    expect(amountsShown()).toBe(false);
  });
  it('aborts and drops an in-flight read on unmount without a state update', async () => {
    const { port, pending } = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    view.unmount();
    expect(request(pending, 0).signal.aborted).toBe(true);
    await act(async () => pending[0]!.resolve({ status: 'ready', page: pageFor(request(pending, 0), 'AFTER-UNMOUNT') }));
    expect(document.body.textContent).not.toContain('AFTER-UNMOUNT');
  });
});

describe('typed faults', () => {
  const faults: readonly (readonly [string, unknown, RegExp, boolean])[] = [
    ['401', { status: 401 }, /not authorized/iu, false],
    ['403', { status: 403 }, /restricted/iu, false],
    ['404', { status: 404 }, /No Finance v2 report has been delivered/u, false],
    ['429', { status: 429 }, /slow down/u, true],
    ['500', { status: 500 }, /unavailable right now/u, true],
    ['503', { status: 503 }, /unavailable right now/u, true],
    ['timeout code', { code: 'TIMEOUT' }, /did not answer in time/u, true],
    ['TimeoutError', { name: 'TimeoutError' }, /did not answer in time/u, true],
    ['untyped throw', new Error('boom'), /could not be loaded/u, false],
  ];
  it.each(faults)('maps %s to a safe state with no amount', async (_name, error, copy, retryable) => {
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    await act(async () => pending[0]!.reject(error));
    expect(document.body.textContent).toMatch(copy);
    expect(amountsShown()).toBe(false);
    expect(screen.queryByRole('button', { name: 'Retry' }) !== null).toBe(retryable);
  });
  it('never echoes a secret carried in the error message, body, headers or stack', async () => {
    const secret = 'Bearer SECRET-TOKEN-123 sk_live_abcdef';
    const error = Object.assign(new Error(secret), { status: 500, body: secret, headers: { authorization: secret }, response: { text: secret } });
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    await act(async () => pending[0]!.reject(error));
    expect(document.body.innerHTML).not.toMatch(/SECRET-TOKEN|sk_live/u);
    expect(document.body.textContent).not.toContain('opaque-token-1');
  });
  it('classifies without reading messages', () => {
    const trap = { get message(): string { throw new Error('message was read'); }, status: 429 };
    expect(classifyFinanceV2Fault(trap)).toEqual({ outcome: 'error', kind: 'rate_limited', retryable: true });
    expect(classifyFinanceV2Fault(null)).toEqual({ outcome: 'error', kind: 'failed', retryable: false });
    expect(classifyFinanceV2Fault({ status: 418 })).toEqual({ outcome: 'error', kind: 'failed', retryable: false });
    expect(classifyFinanceV2Fault({ status: '500' })).toEqual({ outcome: 'error', kind: 'failed', retryable: false });
  });
  it('times out a port that never answers, aborts it, and drops a late answer', async () => {
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port, { timeoutMs: 30 })} />);
    await settle();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('did not answer in time'));
    expect(request(pending, 0).signal.aborted).toBe(true);
    await act(async () => pending[0]!.resolve({ status: 'ready', page: pageFor(request(pending, 0), 'LATE-AFTER-TIMEOUT') }));
    expect(document.body.textContent).not.toContain('LATE-AFTER-TIMEOUT');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});

describe('retry', () => {
  it('retries a retryable fault with a fresh request and token, and shows the new answer only', async () => {
    const { port, pending } = manualPort();
    let tokens = 0;
    render(<FinanceV2ConnectedView {...connected(port, { authorization: { revision: '1', token: async () => `opaque-${++tokens}` } })} />);
    await settle();
    await act(async () => pending[0]!.reject({ status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading the report');
    await settle();
    expect(pending).toHaveLength(2);
    expect(request(pending, 1).authorization.token).toBe('opaque-2');
    await act(async () => pending[1]!.resolve({ status: 'ready', page: pageFor(request(pending, 1), 'RETRY-OK') }));
    expect(await screen.findByRole('region', { name: 'Budget advisory' })).toBeVisible();
    expect(document.body.textContent).toContain('RETRY-OK');
  });
  it('drops the answer of an attempt superseded by a retry (retry while the first attempt is still timing out)', async () => {
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port, { timeoutMs: 25 })} />);
    await settle();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    await act(async () => pending[0]!.resolve({ status: 'ready', page: pageFor(request(pending, 0), 'FIRST-ATTEMPT') }));
    expect(document.body.textContent).not.toContain('FIRST-ATTEMPT');
    await act(async () => pending[1]!.resolve({ status: 'ready', page: pageFor(request(pending, 1), 'SECOND-ATTEMPT') }));
    expect(document.body.textContent).toContain('SECOND-ATTEMPT');
  });
  it('offers no retry for a 401, 403 or an untyped failure', async () => {
    for (const status of [401, 403]) {
      const { port, pending } = manualPort();
      const view = render(<FinanceV2ConnectedView {...connected(port)} />);
      await settle();
      await act(async () => pending[0]!.reject({ status }));
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
      view.unmount();
    }
  });
});

describe('host authorization, revocation and availability', () => {
  it('does not call the port when the host has no token, and reads unauthorized', async () => {
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port, { authorization: authorization('1', null) })} />);
    await settle();
    expect(pending).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('not authorized');
    expect(amountsShown()).toBe(false);
  });
  it('revokes a settled answer when the revision changes and the host then has no token', async () => {
    const { port, pending } = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    await act(async () => pending[0]!.resolve({ status: 'ready', page: pageFor(request(pending, 0), 'BEFORE-REVOKE') }));
    expect(document.body.textContent).toContain('BEFORE-REVOKE');
    view.rerender(<FinanceV2ConnectedView {...connected(port, { authorization: authorization('2', null) })} />);
    await settle();
    expect(document.body.textContent).not.toContain('BEFORE-REVOKE');
    expect(amountsShown()).toBe(false);
    expect(pending).toHaveLength(1);
  });
  it.each([['restricted', /restricted/u], ['unauthorized', /not authorized/u], ['unavailable', /unavailable/u]] as const)('an explicit host refusal (%s) never calls the port and shows no amount', async (reason, copy) => {
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port, { availability: { status: 'refused', reason } })} />);
    await settle();
    expect(pending).toHaveLength(0);
    expect(document.body.textContent).toMatch(copy);
    expect(amountsShown()).toBe(false);
  });
  it('withdraws a settled answer and aborts an in-flight read when the host refuses afterwards', async () => {
    const { port, pending } = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    const inFlight = request(pending, 0);
    view.rerender(<FinanceV2ConnectedView {...connected(port, { availability: { status: 'refused', reason: 'restricted' } })} />);
    expect(inFlight.signal.aborted).toBe(true);
    await act(async () => pending[0]!.resolve({ status: 'ready', page: pageFor(inFlight, 'AFTER-REFUSAL') }));
    expect(document.body.textContent).not.toContain('AFTER-REFUSAL');
    expect(amountsShown()).toBe(false);
  });
});

describe('identity checks on the delivered page (string comparison only)', () => {
  const refused = async (over: Page) => {
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    await act(async () => pending[0]!.resolve({ status: 'ready', page: pageFor(request(pending, 0), 'x', over) }));
    return screen.getByRole('alert');
  };
  it.each([
    ['queryContentHash', { queryContentHash: `sha256:${'d'.repeat(64)}` }, 'QUERY_HASH_MISMATCH', '/queryContentHash'],
    ['summaryContentHash', { summaryContentHash: `sha256:${'e'.repeat(64)}` }, 'SUMMARY_HASH_MISMATCH', '/summaryContentHash'],
    ['snapshotId', { snapshotId: `sha256:${'f'.repeat(64)}` }, 'SNAPSHOT_MISMATCH', '/snapshotId'],
    ['scope', { scope: { ...syntheticOpaqueScope, billingMode: 'live' } }, 'SCOPE_MISMATCH', '/scope/billingMode'],
    ['schemaVersion', { schemaVersion: '1.0.0' }, 'UNSUPPORTED_VERSION', '/schemaVersion'],
  ] as const)('refuses a page with a different %s', async (_name, over, code, path) => {
    const alert = await refused(over);
    expect(alert).toHaveTextContent(code);
    expect(alert).toHaveTextContent(path);
    expect(amountsShown()).toBe(false);
  });
  it('refuses an invalid page shape', async () => {
    const alert = await refused({ summary: { nope: true } });
    expect(alert).toHaveTextContent('INVALID_SHAPE');
    expect(amountsShown()).toBe(false);
  });
  it.each(['missing', 'restricted', 'unauthorized', 'unknown'] as const)('shows %s with no amount', async (status) => {
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    await act(async () => pending[0]!.resolve({ status }));
    expect(amountsShown()).toBe(false);
    expect(screen.queryByRole('region', { name: 'Snapshot and scope' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'USD budget advisory' })).toBeNull();
  });
  it.each([null, undefined, 7, 'ready', { status: 'bogus' }])('treats a malformed port answer %j as unknown', async (answer) => {
    const { port, pending } = manualPort();
    render(<FinanceV2ConnectedView {...connected(port)} />);
    await settle();
    await act(async () => pending[0]!.resolve(answer as never));
    expect(screen.getByRole('status')).toHaveTextContent('could not be determined');
    expect(amountsShown()).toBe(false);
  });
});

describe('CFO export stays disabled', () => {
  it('offers only a disabled export button, no download link, and no success state, on every view', async () => {
    for (const view of ['budget', 'breakdown', 'transactions'] as const) {
      const { port, pending } = manualPort();
      const rendered = render(<FinanceV2ConnectedView {...connected(port, { view })} />);
      await settle();
      await act(async () => pending[0]!.resolve({ status: 'ready', page: pageFor(request(pending, 0), 'export') }));
      expect(await screen.findByRole('button', { name: 'Export unavailable' })).toBeDisabled();
      expect(document.querySelector('a[download]')).toBeNull();
      expect(document.body.textContent).toContain('no export success is claimed');
      expect(document.body.textContent).not.toMatch(/export (?:complete|succeeded|ready)|download(?:ed)? /iu);
      rendered.unmount();
    }
  });
});

describe('through the real Dashboard route', () => {
  function Host({ mode, port }: { mode: 'SYNTHETIC_PROPOSAL' | 'INTEGRATED'; port: FinanceV2SyntheticReadPort | undefined }) {
    const provider = useMemo(() => fixtureProvider('ready'), []);
    const [revision, setRevision] = useState('1');
    return <>
      <button type="button" onClick={() => setRevision('2')}>bump</button>
      <Dashboard basePath="/admin/finance" pathname={`/admin/finance/transactions/${detailIds.refund}`} navigate={() => undefined} access={authorizedFixture} provider={provider}
        renderRoute={({ route }) => <FinanceV2ConnectedView {...({ ...connected(port, { view: route.id === 'transaction-detail' ? 'transaction-detail' : 'transactions', authorization: authorization(revision), ...(route.params.id ? { detailId: route.params.id } : {}) }), mode } as FinanceV2ConnectedViewProps)} />} />
    </>;
  }
  it('hydrates the detail route from the injected port and refetches when the revision changes', async () => {
    const { port, pending } = manualPort();
    render(<Host mode="SYNTHETIC_PROPOSAL" port={port} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]!.resolve({ status: 'ready', page: pageFor(request(pending, 0), 'ROUTE-1') }));
    expect(await screen.findByRole('region', { name: 'Transaction record' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'bump' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(document.body.textContent).not.toContain('ROUTE-1');
    await act(async () => pending[1]!.resolve({ status: 'ready', page: pageFor(request(pending, 1), 'ROUTE-2') }));
    expect(document.body.textContent).toContain('ROUTE-2');
  });
  it('renders integrated mode unavailable inside the Dashboard', async () => {
    const { port, pending } = manualPort();
    render(<Host mode="INTEGRATED" port={port} />);
    expect(await screen.findByText(/no accepted read port exists/u)).toBeVisible();
    expect(pending).toHaveLength(0);
  });
});
