import { renderToString } from 'react-dom/server';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AmountText, MetricCard, StateBadge, FilterSelect, Pagination, DataTable, BreakdownChart, Tooltip, EvidenceLink, ScopeContext, ReturnToResults, type AmountDisplay, type ChartItem, type EvidenceDisplay, type EvidencePolicy, type ScopeDisplay } from '../../src';
import { exactSamples, sampleColumns, sampleRows, chartSamples } from '../fixtures/td10-display';
const policy: EvidencePolicy = { origin: 'https://host.example', allowedOrigins: ['https://approved.example'], allowedPathPrefixes: ['/admin/finance', '/records'], allowedQueryKeys: ['sample'] };

describe('TD-10 exact display and minimization', () => {
  it.each(['zero', 'negative', 'subcent'])('preserves supplied %s text without rounding', (key) => {
    const amount = exactSamples[key]!; render(<AmountText amount={amount} />);
    if (amount.status === 'available') { expect(screen.getByText(amount.text, { exact: true })).toBeVisible(); expect(screen.getByText(amount.currency)).toBeVisible(); }
  });
  it.each(['unknown', 'restricted', 'unavailable'] as const)('does not expose forbidden %s amount fields', (status) => {
    const value = { status, text: 'restricted-value-canary', currency: 'secret-currency' } as AmountDisplay;
    const { container } = render(<AmountText amount={value} />);
    expect(container.textContent).toContain(status); expect(container.innerHTML).not.toContain('canary'); expect(container.innerHTML).not.toContain('secret-currency'); expect(container.textContent).not.toMatch(/0\.00/u);
  });
  it('suppresses restricted metric annotations and scope labels', () => {
    const { container } = render(<><MetricCard title="Restricted metric" amount={{ status: 'restricted' }} description="private-description-canary" states={['confirmed']} /><ScopeContext scope={{ status: 'restricted', projectLabel: 'private-project-canary' } as ScopeDisplay} /></>);
    expect(container.innerHTML).not.toContain('canary'); expect(screen.queryByText('Valuation: confirmed')).toBeNull(); expect(screen.getByText('Scope restricted')).toBeVisible();
  });
  it('keeps valuation, reconciliation and evidence as separate text indicators', () => {
    render(<><StateBadge state="estimated" /><StateBadge state="reconciled" /><StateBadge state="sandbox" /></>);
    expect(screen.getByText('Valuation: estimated')).toBeVisible(); expect(screen.getByText('Reconciliation: reconciled')).toBeVisible(); expect(screen.getByText('Evidence: sandbox')).toBeVisible();
  });
});

describe('TD-10 controlled controls and table', () => {
  it('emits allowed filter values without mutating its controlled value', () => {
    const change = vi.fn(); render(<FilterSelect label="Display filter" value="a" options={[{ value: 'a', label: 'First' }, { value: 'b', label: 'Second' }, { value: 'blocked', label: 'Unavailable', disabled: true }]} onChange={change} description="Synthetic only" />);
    const select = screen.getByRole('combobox', { name: 'Display filter' });
    expect(select).toHaveAccessibleDescription('Synthetic only'); fireEvent.change(select, { target: { value: 'b' } }); expect(change).toHaveBeenLastCalledWith('b'); expect(select).toHaveValue('a');
    change.mockClear(); fireEvent.change(select, { target: { value: 'blocked' } }); expect(change).not.toHaveBeenCalled();
  });
  it('uses real disabled pagination and never invents a total', () => {
    const navigate = vi.fn(); render(<Pagination pageLabel="Supplied page label; count unavailable" hasPrevious={false} hasNext onNavigate={navigate} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Previous page' })); expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' })); expect(navigate).toHaveBeenCalledWith('next'); expect(screen.getByRole('status')).toHaveTextContent('count unavailable');
  });
  it('exposes native headers and controlled sorting, and ignores unprojected fields', () => {
    const sort = vi.fn(); const rows = [{ ...sampleRows[0]!, customerAddress: 'private-address-canary', cells: { ...sampleRows[0]!.cells, unexpected: { kind: 'text', text: 'private-cell-canary' } as const } }];
    const { container } = render(<DataTable caption="Projected records" columns={sampleColumns} rows={rows} sort={{ key: 'record', direction: 'ascending' }} onSort={sort} linkPolicy={policy} />);
    const table = screen.getByRole('table', { name: 'Projected records' }); expect(within(table).getAllByRole('columnheader')).toHaveLength(4); expect(within(table).getByRole('rowheader')).toBeVisible();
    const header = within(table).getByRole('columnheader', { name: /Record/u }); expect(header).toHaveAttribute('aria-sort', 'ascending'); fireEvent.click(within(header).getByRole('button')); expect(sort).toHaveBeenCalledWith({ key: 'record', direction: 'descending' }); expect(header).toHaveAttribute('aria-sort', 'ascending'); expect(container.innerHTML).not.toContain('canary');
  });
  it('server renders table content before browser layout measurements', () => { const html = renderToString(<DataTable caption="Server table" columns={sampleColumns} rows={sampleRows} linkPolicy={policy} />); expect(html).toContain('Server table'); expect(html).toContain('-12345678901234567890.000000137'); });
  it('offers native keyboard-operable buttons for an overflowing read-only table', () => {
    render(<DataTable caption="Scrollable records" columns={sampleColumns} rows={sampleRows} linkPolicy={policy} />);
    const region = screen.getByRole('region', { name: 'Scrollable records' });
    Object.defineProperties(region, { clientWidth: { value: 300 }, scrollWidth: { value: 900 }, scrollLeft: { value: 0, writable: true } });
    const scroll = vi.fn(({ left }: { left: number }) => { region.scrollLeft = Math.min(600, Math.max(0, left)); fireEvent.scroll(region); }); Object.defineProperty(region, 'scrollTo', { value: scroll }); fireEvent.scroll(region);
    const right = screen.getByRole('button', { name: 'Scroll Scrollable records right' }); expect(right).toHaveAttribute('aria-controls', region.id); fireEvent.click(right); expect(scroll).toHaveBeenLastCalledWith({ left: 225, behavior: 'auto' });
    fireEvent.keyDown(right, { key: 'End' }); expect(region.scrollLeft).toBe(600); expect(right).toHaveAttribute('aria-disabled', 'true'); fireEvent.keyDown(right, { key: 'Home' }); expect(region.scrollLeft).toBe(0);
  });
  it('renders explicit empty rows without fabricated amounts', () => { render(<DataTable caption="Empty display" columns={sampleColumns} rows={[]} linkPolicy={policy} />); expect(screen.getByText('No rows to display.')).toBeVisible(); expect(screen.queryByText('0')).toBeNull(); });
});

describe('TD-10 chart alternative and tooltip', () => {
  it('provides an explicit empty chart table without invented values', () => { render(<BreakdownChart title="Empty chart" items={[]} />); expect(within(screen.getByRole('table')).getByRole('cell')).toHaveAttribute('colspan', '3'); expect(screen.getByRole('status')).toHaveTextContent('No categories to display.'); expect(screen.queryByText('0')).toBeNull(); });
  it('preserves exact values in the always available table', () => {
    render(<BreakdownChart title="Display breakdown" items={chartSamples} />);
    const table = screen.getByRole('table', { name: 'Display breakdown — exact data alternative' });
    expect(within(table).getByText('-12345678901234567890.000000137', { exact: true })).toBeVisible(); expect(within(table).getByText('0.000000137', { exact: true })).toBeVisible(); expect(within(table).getByText('Amount restricted')).toBeVisible();
  });
  it.each([NaN, Infinity, -Infinity, 1.01, -1.01])('rejects invalid visual position %s while retaining exact display', (position) => {
    render(<BreakdownChart title="Invalid position" items={[{ status: 'visible', id: 'item', label: 'Sample', amount: exactSamples.subcent!, position, note: 'Tooltip' }]} />);
    expect(screen.getByText('Chart position unavailable')).toBeVisible(); expect(screen.queryByRole('button')).toBeNull(); expect(screen.getByText('0.000000137')).toBeVisible();
  });
  it('never emits restricted plot values or tooltips', () => {
    const item = { status: 'restricted', id: 'safe-id', label: 'private-chart-canary', position: .9, note: 'private-tooltip-canary', amount: exactSamples.negative } as ChartItem;
    const { container } = render(<BreakdownChart title="Restricted plot" items={[item]} />); expect(container.innerHTML).not.toContain('canary'); expect(container.querySelector('.td-bar')).toBeNull();
  });
  it('opens on focus and hover, closes on Escape and blur', () => {
    render(<Tooltip label="Show details" text="Safe note" />); const button = screen.getByRole('button', { name: 'Show details' });
    fireEvent.focus(button); expect(screen.getByRole('tooltip')).toHaveTextContent('Safe note'); expect(button).toHaveAccessibleDescription('Safe note');
    fireEvent.keyDown(button, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull(); fireEvent.blur(button); fireEvent.mouseEnter(button.parentElement!); expect(screen.getByRole('tooltip')).toBeVisible(); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull(); fireEvent.mouseLeave(button.parentElement!); fireEvent.mouseEnter(button.parentElement!); expect(screen.getByRole('tooltip')).toBeVisible(); fireEvent.mouseLeave(button.parentElement!); expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('TD-10 safe evidence presentation', () => {
  const rejected = ['javascript:alert(1)', 'data:text/html,secret', 'file:///secret', 'blob:https://host.example/id', '//evil.example/records/a', 'https://user:password@host.example/records/a', 'https://evil.example/records/a', 'http://approved.example/records/a', '/private/secret', '/records/a?token=secret', '/records/a#secret', '/records/%2fsecret', '/records/%00secret', '/records/%zz', '/records/%252fsecret', '/records/secret' + String.fromCharCode(10)];
  it.each(rejected)('hides rejected URL and label: %s', (href) => {
    const { container } = render(<EvidenceLink evidence={{ status: 'permitted', href, label: 'private-label-canary' }} policy={policy} />);
    expect(screen.queryByRole('link')).toBeNull(); expect(screen.getByText('Evidence unavailable')).toBeVisible(); expect(container.innerHTML).not.toContain('canary'); expect(container.innerHTML).not.toContain('secret');
  });
  it.each(['restricted', 'unavailable'] as const)('hides unexpected fields for %s decisions', (status) => {
    const evidence = { status, label: 'private-label-canary', href: '/records/private-url-canary' } as EvidenceDisplay;
    const { container } = render(<EvidenceLink evidence={evidence} policy={policy} />); expect(container.innerHTML).not.toContain('canary'); expect(screen.queryByRole('link')).toBeNull();
  });
  it.each(['token', 'access_token', 'refreshToken', 'SIGNATURE', 'X-Amz-Credential', 'api-key', 'authorization', 'password', 'code', 'sessionid'])('rejects credential query %s even when allowlisted', (key) => {
    const { container } = render(<EvidenceLink evidence={{ status: 'permitted', href: `/records/safe?${key}=private-value-canary`, label: 'private-label-canary' }} policy={{ ...policy, allowedQueryKeys: [key] }} />);
    expect(screen.queryByRole('link')).toBeNull(); expect(container.innerHTML).not.toContain('canary');
  });
  it.each(['/records/../private/secret', '/records/%2e%2e/private/secret', '/records/%2E./records/safe', '/records/./safe', '/records/%2e/safe', '/records-neighbor/safe'])('rejects dot normalization and prefix escapes: %s', (href) => {
    const { container } = render(<EvidenceLink evidence={{ status: 'permitted', href, label: 'private-label-canary' }} policy={policy} />); expect(screen.queryByRole('link')).toBeNull(); expect(container.innerHTML).not.toContain('canary');
  });
  it('allows only approved destinations and preserves native modifier behavior', () => {
    const navigate = vi.fn(); const { rerender } = render(<EvidenceLink evidence={{ status: 'permitted', href: '/records/safe?sample=one', label: 'Open permitted evidence' }} policy={policy} onNavigate={navigate} />);
    const link = screen.getByRole('link'); link.addEventListener('click', (event) => { if (event.ctrlKey) event.preventDefault(); }); fireEvent.click(link, { ctrlKey: true }); expect(navigate).not.toHaveBeenCalled(); fireEvent.click(link); expect(navigate).toHaveBeenCalledWith('/records/safe?sample=one');
    rerender(<EvidenceLink evidence={{ status: 'permitted', href: 'https://approved.example/records/safe', label: 'Open approved external evidence' }} policy={policy} />); expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer'); expect(screen.getByRole('link')).toHaveAccessibleName('Open approved external evidence (external site)');
  });
  it('returns through the host rather than changing browser history itself', () => { const navigate = vi.fn(); render(<ReturnToResults href="/admin/finance/transactions" policy={policy} onNavigate={navigate} />); fireEvent.click(screen.getByRole('link', { name: 'Return to results' })); expect(navigate).toHaveBeenCalledWith('/admin/finance/transactions'); });
});
