import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dashboard } from '../../src';
import { FinancialSummaryView, evaluateFinancePacket } from '../../src/views/financial-summary';
import { authorizedFixture, fixtureProvider, summaryFixture, summaryFixtureNames, syntheticProjectLabel, type SummaryFixtureName } from '../../integration/fixture-host/host';

/** Real client mount (effects run, provider resolves asynchronously) of the actual `Dashboard`; data is the synthetic fixture host's only. */
function mount(name: SummaryFixtureName, pathname = '/admin/finance') {
  return render(<Dashboard basePath="/admin/finance" pathname={pathname} navigate={() => undefined} access={authorizedFixture} provider={fixtureProvider('ready')}
    renderRoute={({ route }) => route.id === 'overview' ? <FinancialSummaryView {...summaryFixture(name, evaluateFinancePacket)} projectLabel={syntheticProjectLabel} /> : null} />);
}

describe('FinancialSummaryView through the real Dashboard overview route (synthetic fixture mode)', () => {
  it('renders the ready fixture after the provider resolves, with source metric labels and the synthetic project label', async () => {
    mount('ready');
    expect(await screen.findByRole('region', { name: 'Financial summary' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Financial scope' })).toHaveTextContent('SYNTHETIC FIXTURE project (not real data)');
    expect(screen.getByRole('heading', { name: 'synthetic.metric_a' }).closest('section')).toHaveTextContent('0.000007');
    expect(within(screen.getByRole('heading', { name: 'synthetic.metric_missing' }).closest('section')!).getByText('Amount unavailable')).toBeVisible();
  });
  it('shows unknown, partial, stale and refused states distinctly and never as amounts', async () => {
    const unknown = mount('unknown');
    expect(await screen.findByText('Amount unknown')).toBeVisible();
    unknown.unmount();
    const partial = mount('partial');
    expect(await screen.findByText('synthetic-source-b')).toBeVisible();
    expect(screen.getByText('Sources expected', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Unknown');
    partial.unmount();
    const stale = mount('stale');
    expect(await screen.findByText(/older than the host freshness policy/u)).toBeVisible();
    stale.unmount();
    mount('unsupported');
    const alert = (await screen.findByText('Unsupported summary contract')).closest('[role="alert"]')!;
    expect(alert).toHaveTextContent('UNSUPPORTED_VERSION');
    expect(alert).toHaveTextContent('/canonicalReferences/schemaVersion');
    expect(screen.queryByRole('heading', { name: /synthetic\.metric/u })).toBeNull();
  });
  it.each([['digest-mismatch', 'DIGEST_MISMATCH'], ['missing-references', 'REFERENCE_MISMATCH']] as const)('refuses the %s packet fixture as %s, not as an unsupported version', async (name, code) => {
    mount(name);
    const alert = (await screen.findByText('Summary refused')).closest('[role="alert"]')!;
    expect(alert).toHaveTextContent(code);
    expect(screen.queryByRole('heading', { name: /synthetic\.metric/u })).toBeNull();
  });
  it('keeps the synthetic Finance response metadata in its own section on the ready fixture only', async () => {
    const ready = mount('ready');
    expect(await screen.findByRole('region', { name: 'Finance response metadata' })).toHaveTextContent('synthetic-watermark');
    ready.unmount();
    mount('partial');
    await screen.findByRole('region', { name: 'Financial summary' });
    expect(screen.queryByRole('region', { name: 'Finance response metadata' })).toBeNull();
  });
  it('covers every fixture name without throwing', async () => {
    for (const name of summaryFixtureNames) {
      const view = mount(name);
      expect(await screen.findByRole('region', { name: 'Financial summary' })).toBeVisible();
      view.unmount();
    }
  });
  it('does not render the summary outside the overview route', async () => {
    mount('ready', '/admin/finance/ai-costs');
    await screen.findByRole('navigation');
    expect(screen.queryByRole('region', { name: 'Financial summary' })).toBeNull();
  });
});
