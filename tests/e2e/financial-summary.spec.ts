import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';

/**
 * Real Chromium + axe over the real, hydrated client: the packed dashboard renders `FinancialSummaryView` from
 * `renderRoute` for the overview route inside the real `Dashboard`. Data is the fixture host's explicit SYNTHETIC
 * `?summary=` fixture mode; there is no real Finance provider, so no real data is claimed or shown.
 */
test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external request in synthetic summary harness.'); }
    await route.continue();
  });
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => { if (message.type() === 'error') throw new Error(message.text()); });
});

async function open(page: Page, summary: string) {
  await page.goto(`/admin/finance?state=ready&summary=${summary}`);
  await expect(page.getByRole('region', { name: 'Financial summary' }).or(page.getByRole('heading', { name: 'Financial summary' }))).toBeVisible();
}
async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).analyze();
  await writeFile(test.info().outputPath(`${name}-axe.json`), JSON.stringify(results, null, 2));
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}
const card = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('..');

test('synthetic ready summary is labelled synthetic, keeps source metric labels, and unavailable stays distinct from a value', async ({ page }) => {
  await open(page, 'ready');
  await expect(page.getByRole('note')).toContainText('SYNTHETIC FIXTURE');
  await expect(page.getByRole('region', { name: 'Financial scope' })).toContainText('SYNTHETIC FIXTURE project (not real data)');
  await expect(card(page, 'synthetic.metric_a')).toContainText('0.000007');
  await expect(card(page, 'synthetic.metric_missing')).toContainText('Amount unavailable');
  await expect(page.getByRole('table', { name: 'Metric provenance' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/\b(spent|earned|remaining|budget|balance)\b/iu);
  await scan(page, 'financial-summary-ready');
});

test('unknown producer metric reads unknown, not zero', async ({ page }) => {
  await open(page, 'unknown');
  await expect(card(page, 'synthetic.metric_u')).toContainText('Amount unknown');
  await expect(card(page, 'synthetic.metric_u')).toContainText('not zero');
  await scan(page, 'financial-summary-unknown');
});

test('partial summary shows incomplete completeness, unknown expected sources and the missing source', async ({ page }) => {
  await open(page, 'partial');
  const coverage = page.getByRole('region', { name: 'Coverage and freshness' });
  await expect(coverage).toContainText('Unknown');
  await expect(coverage).toContainText('synthetic-source-b');
  await expect(page.getByRole('region', { name: 'Summary states' })).toContainText('incomplete');
  await scan(page, 'financial-summary-partial');
});

test('stale summary announces staleness and passes axe', async ({ page }) => {
  await open(page, 'stale');
  await expect(page.getByRole('status').filter({ hasText: 'older than the host freshness policy' })).toBeVisible();
  await expect(card(page, 'synthetic.metric_a')).toContainText('0.000007');
  await scan(page, 'financial-summary-stale');
});

for (const [name, title] of [['missing', 'No summary delivered'], ['restricted', 'Summary restricted']] as const) {
  test(`${name} summary shows a status and no amounts`, async ({ page }) => {
    await open(page, name);
    await expect(page.getByRole('status').filter({ hasText: title })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: /synthetic\.metric/u })).toHaveCount(0);
    await scan(page, `financial-summary-${name}`);
  });
}

test('refused contract result renders an alert with its code and no amounts', async ({ page }) => {
  await open(page, 'refused');
  await expect(page.getByRole('alert').filter({ hasText: 'Summary refused' })).toContainText('CONTRACT_REFUSED');
  await expect(page.getByRole('heading', { level: 3, name: /synthetic\.metric/u })).toHaveCount(0);
  await scan(page, 'financial-summary-refused');
});

test('a packet with an unsupported wire version is refused as unsupported, never relabelled', async ({ page }) => {
  await open(page, 'unsupported');
  const alert = page.getByRole('alert').filter({ hasText: 'Unsupported summary contract' });
  await expect(alert).toContainText('UNSUPPORTED_VERSION');
  await expect(alert).toContainText('/canonicalReferences/schemaVersion');
  await expect(page.getByRole('heading', { level: 3, name: /synthetic\.metric/u })).toHaveCount(0);
  await scan(page, 'financial-summary-unsupported');
});

for (const [name, code, path] of [['digest-mismatch', 'DIGEST_MISMATCH', '/canonicalReferences/schemas/FinancialSummary/sha256'], ['missing-references', 'REFERENCE_MISMATCH', '/trusted/references']] as const) {
  test(`a compatible-version packet with ${name.replace('-', ' ')} is refused by the gate, not by package version`, async ({ page }) => {
    await open(page, name);
    const alert = page.getByRole('alert').filter({ hasText: 'Summary refused' });
    await expect(alert).toContainText(code);
    await expect(alert).toContainText(path);
    await expect(page.getByRole('heading', { level: 3, name: /synthetic\.metric/u })).toHaveCount(0);
    await scan(page, `financial-summary-${name}`);
  });
}

test('the Finance response metadata is shown apart from the summary on the synthetic ready fixture', async ({ page }) => {
  await open(page, 'ready');
  await expect(page.getByRole('region', { name: 'Finance response metadata' })).toContainText('synthetic-watermark');
});

test('without the explicit synthetic parameter the overview renders no summary', async ({ page }) => {
  await page.goto('/admin/finance?state=ready');
  await expect(page.getByText('Read-only extension fixture')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Financial summary' })).toHaveCount(0);
});

test('a non-overview route does not render the summary', async ({ page }) => {
  await page.goto('/admin/finance/ai-costs?state=ready&summary=ready');
  await expect(page.getByRole('heading', { name: 'Financial summary' })).toHaveCount(0);
});

test('keyboard reaches the overflowing provenance table scroll controls at 320 CSS pixels and operates them', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page, 'ready');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  const right = page.getByRole('button', { name: 'Scroll Metric provenance right' });
  await expect(right).toBeVisible();
  const viewport = page.getByRole('region', { name: 'Metric provenance' });
  await right.focus();
  await expect(right).toBeFocused();
  await page.keyboard.press('End');
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('Home');
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(0);
  await expect(right).toBeFocused();
});
