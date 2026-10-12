import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';

/**
 * Real Chromium + axe over the real, hydrated client: the packed dashboard renders `FinanceV2View` from `renderRoute` for the
 * budgets, ai-costs, transactions and transaction-detail routes inside the real `Dashboard`. Data is the fixture host's explicit
 * SYNTHETIC_PROPOSAL `?v2=` mode generated from the frozen, unaccepted Finance v2 proposal. There is no Finance provider, so no
 * real data is claimed or shown.
 */
test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external request in synthetic Finance v2 harness.'); }
    await route.continue();
  });
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => { if (message.type() === 'error') throw new Error(message.text()); });
});

const route = (page: Page, path: string, fixture: string) => page.goto(`/admin/finance/${path}?state=ready&v2=${fixture}`);
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).analyze();
  await writeFile(test.info().outputPath(`${name}-axe.json`), JSON.stringify(results, null, 2));
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}
/** Real keyboard only: Tab from the document start until `target` is the active element. No `.focus()` surrogate. */
async function tabTo(page: Page, target: Locator, limit = 300) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let tabs = 0; tabs < limit; tabs += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('Tab alone did not reach the keyboard target.');
}
const refundId = `sha256:${[...'detail-refund'].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0')}`;

test('budget advisory is labelled SYNTHETIC_PROPOSAL, advisory-only, and keeps lifecycle consumed apart from ledger expense', async ({ page }) => {
  await route(page, 'budgets', 'ready');
  await expect(region(page, 'Budget advisory')).toBeVisible();
  await expect(page.getByRole('note')).toContainText('SYNTHETIC_PROPOSAL');
  const card = region(page, 'USD budget advisory');
  await expect(card).toContainText('Advisory only. Remaining authorized capacity is not spend authority');
  await expect(card.getByRole('heading', { name: 'USD ledger expense' }).locator('..')).toContainText('42.000000000000000000');
  await expect(card.getByRole('heading', { name: 'USD lifecycle consumed' }).locator('..')).toContainText('It is not ledger expense');
  await expect(card.getByRole('heading', { name: 'USD remaining authorized capacity (advisory)' }).locator('..')).toContainText('Not spend authority');
  await expect(region(page, 'Snapshot and scope')).toContainText('account:synthetic-tenant');
  await scan(page, 'finance-v2-budget');
});

test('mixed-currency budgets stay separate and a null limit reads unknown, not zero', async ({ page }) => {
  await route(page, 'budgets', 'mixed-currency-partial');
  const eur = region(page, 'EUR budget advisory');
  await expect(eur).not.toContainText('USD');
  await expect(eur.getByRole('heading', { name: 'EUR limit' }).locator('..')).toContainText('Amount unknown');
  await expect(eur).toContainText('No policy reference delivered');
  await scan(page, 'finance-v2-budget-mixed');
});

test('cost breakdown shows verbatim parent totals per currency with partial, unknown, unallocated and simulated kept apart', async ({ page }) => {
  await route(page, 'ai-costs', 'mixed-currency-partial');
  const usd = region(page, 'USD cost breakdown');
  const expense = usd.getByRole('table', { name: 'USD parent totals' }).getByRole('row', { name: /expense/u }).first();
  await expect(expense).toContainText('partial');
  await expect(expense).toContainText('30.000000000000000000');
  await expect(expense).toContainText('Amount unknown');
  await expect(usd.getByRole('table', { name: 'USD by provider' })).toContainText('Unallocated (no value delivered)');
  await expect(region(page, 'USD simulated')).toContainText('simulated (not actual)');
  await expect(region(page, 'EUR cost breakdown')).not.toContainText('USD');
  await expect(region(page, 'Coverage')).toContainText('synthetic-cash-source');
  await scan(page, 'finance-v2-breakdown');
});

test('unknown coverage reads unknown and shows no zero amounts in the parent totals', async ({ page }) => {
  await route(page, 'ai-costs', 'unknown-coverage');
  await expect(region(page, 'Coverage')).toContainText('Unknown');
  await expect(region(page, 'USD parent totals')).not.toContainText(/\d\.\d{18}/u);
  await scan(page, 'finance-v2-unknown');
});

test('transaction drilldown opens a detail from the list and returns, with refund and negative strings verbatim', async ({ page }) => {
  await route(page, 'transactions', 'ready');
  const table = page.getByRole('table', { name: 'Transaction details' });
  await expect(table.getByRole('row', { name: /sale\.refunded/u })).toContainText('-10.000000000000000000');
  await expect(table.getByRole('row', { name: /ai\.usage.*unknown/u }).last()).toContainText('Amount unknown');
  await scan(page, 'finance-v2-transactions');
  await table.getByRole('link', { name: refundId }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions/${encodeURIComponent(refundId)}\\?state=ready&v2=ready$`, 'u'));
  await expect(region(page, 'Transaction record')).toContainText('-10.000000000000000000');
  await expect(region(page, 'Detail states')).toContainText('partly_paid');
  await expect(region(page, 'USD parent totals for this snapshot')).toContainText('This detail is not added to them');
  await scan(page, 'finance-v2-detail');
  await page.getByRole('link', { name: 'Back to transactions' }).click();
  await expect(page.getByRole('table', { name: 'Transaction details' })).toBeVisible();
});

test('the valuation filter narrows the list without changing amounts', async ({ page }) => {
  await route(page, 'transactions', 'ready');
  await page.getByLabel('Valuation').selectOption('unknown');
  const table = page.getByRole('table', { name: 'Transaction details' });
  await expect(table).toContainText('Amount unknown');
  await expect(table).not.toContainText('-10.000000000000000000');
  await page.getByLabel('Currency').selectOption('all');
});

test('CFO export is restricted on every view and offers no action', async ({ page }) => {
  for (const path of ['budgets', 'ai-costs', 'transactions']) {
    await route(page, path, 'ready');
    const section = region(page, 'CFO export');
    await expect(section).toContainText('Export is restricted');
    await expect(section.getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
  }
  await expect(page.locator('main')).not.toContainText(/export (started|complete|succeeded)|downloaded/iu);
});

for (const [fixture, code] of [['forged-scope', 'SCOPE_MISMATCH'], ['forged-snapshot', 'SNAPSHOT_MISMATCH'], ['unsupported-version', 'UNSUPPORTED_VERSION'], ['invalid-shape', 'INVALID_SHAPE']] as const) {
  test(`${fixture} is refused with ${code} and shows no amounts`, async ({ page }) => {
    await route(page, 'ai-costs', fixture);
    await expect(page.getByRole('alert').filter({ hasText: 'Report refused' })).toContainText(code);
    await expect(page.locator('main')).not.toContainText(/\d\.\d{18}/u);
    await scan(page, `finance-v2-${fixture}`);
  });
}

for (const [fixture, title] of [['missing', 'No report delivered'], ['restricted', 'Report restricted'], ['unauthorized', 'Not authorized'], ['unknown-state', 'Finance state unknown']] as const) {
  test(`${fixture} shows a notice and no amounts`, async ({ page }) => {
    await route(page, 'budgets', fixture);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/\d\.\d{18}/u);
    await scan(page, `finance-v2-${fixture}`);
  });
}

test('without the explicit v2 parameter these routes render no Finance v2 view', async ({ page }) => {
  await page.goto('/admin/finance/budgets?state=ready');
  await expect(page.getByText('Read-only extension fixture')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Budget advisory' })).toHaveCount(0);
});

test('the overview does not render the Finance v2 view', async ({ page }) => {
  await page.goto('/admin/finance?state=ready&v2=ready');
  await expect(page.getByRole('heading', { name: 'Budget advisory' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Cost breakdown' })).toHaveCount(0);
});

test('breakdown reflows at 320 CSS pixels without page-level horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await route(page, 'ai-costs', 'mixed-currency-partial');
  await expect(region(page, 'Cost breakdown')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('keyboard Tab reaches a transaction link, Enter opens the detail with intentional focus, and Back returns to the list context', async ({ page }) => {
  await route(page, 'transactions', 'ready');
  const link = page.getByRole('table', { name: 'Transaction details' }).getByRole('link', { name: refundId });
  await tabTo(page, link);
  await expect(link).toBeFocused();
  await expect(link).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/transactions/${encodeURIComponent(refundId)}\\?state=ready&v2=ready$`, 'u'));
  await expect(region(page, 'Transaction record')).toContainText('-10.000000000000000000');
  // Detail focus is intentional: the route heading takes focus, not the removed list link and not <body>.
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await tabTo(page, page.getByRole('link', { name: 'Back to transactions' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/transactions\?state=ready&v2=ready$/u);
  await expect(page.getByRole('table', { name: 'Transaction details' })).toBeVisible();
  // Return context: focus lands on the list route heading, never on <body>.
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test('keyboard-operated filters survive detail, Back and reload: unknown stays unknown, valuation and currency stay together', async ({ page }) => {
  await route(page, 'transactions', 'mixed-currency-partial');
  const valuation = page.getByLabel('Valuation');
  const currency = page.getByLabel('Currency');
  const table = page.getByRole('table', { name: 'Transaction details' });
  // Options: all, estimated, provider_confirmed, unknown. Real arrow keys on the focused native select.
  await tabTo(page, valuation);
  for (let presses = 0; presses < 3; presses += 1) await page.keyboard.press('ArrowDown');
  await expect(valuation).toHaveValue('unknown');
  await expect(page).toHaveURL(/valuation=unknown/u);
  await expect(table).toContainText('Amount unknown');
  await expect(table).not.toContainText('8.000000000000000000 EUR');
  const unknownLink = table.getByRole('link', { name: /^sha256:/u });
  await expect(unknownLink).toHaveCount(1);
  await tabTo(page, unknownLink);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/transactions\/sha256[^?]*\?.*valuation=unknown/u);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await tabTo(page, page.getByRole('link', { name: 'Back to transactions' }));
  await page.keyboard.press('Enter');
  await expect(valuation).toHaveValue('unknown');
  await expect(currency).toHaveValue('all');
  await expect(table).toContainText('Amount unknown');
  await expect(table).not.toContainText('8.000000000000000000 EUR');
  // Deep link and reload keep the same filters; nothing is silently reset to all.
  await page.reload();
  await expect(page.getByLabel('Valuation')).toHaveValue('unknown');
  await page.goto('/admin/finance/transactions?state=ready&v2=mixed-currency-partial&valuation=provider_confirmed&currency=EUR');
  await expect(page.getByLabel('Valuation')).toHaveValue('provider_confirmed');
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');
  const eurLink = page.getByRole('table', { name: 'Transaction details' }).getByRole('link', { name: /^sha256:/u });
  await expect(eurLink).toHaveCount(1);
  await eurLink.click();
  await page.getByRole('link', { name: 'Back to transactions' }).click();
  await expect(page.getByLabel('Valuation')).toHaveValue('provider_confirmed');
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');
  await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('8.000000000000000000 EUR');
  await scan(page, 'finance-v2-transactions-filtered');
});

for (const [path, fixture, name] of [['transactions', 'ready', 'Transaction details'], ['ai-costs', 'mixed-currency-partial', 'USD by provider']] as const) {
  test(`${path}: overflowing "${name}" table scroll controls are keyboard reachable and Home/End scroll it at 320 CSS pixels`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await route(page, path, fixture);
    const viewport = region(page, name);
    const right = page.getByRole('button', { name: `Scroll ${name} right` });
    await expect(right, 'the table must really overflow at 320px for this journey to apply').toBeVisible();
    expect(await viewport.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(true);
    await tabTo(page, right);
    await expect(right).toBeFocused();
    await page.keyboard.press('End');
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await page.keyboard.press('Home');
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(0);
    await expect(right).toBeFocused();
    await scan(page, `finance-v2-${path}-keyboard-320`);
  });
}

test('budget view has no overflowing table, so it needs no scroll controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await route(page, 'budgets', 'ready');
  await expect(region(page, 'Budget advisory')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Scroll .* (left|right)$/u })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
