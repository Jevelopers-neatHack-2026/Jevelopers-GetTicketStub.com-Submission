import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinancialSummaryView, refuseUnsupportedPacket } from '../../src/views/financial-summary';
import type { ProjectionResult, SummaryProjection } from '../../src/data/shared-contracts-adapter';
import { projection, ready, requestedOf, stale } from '../components/financial-summary.fixtures';

/**
 * Real Chromium + axe over the real view markup, styled by the packed dashboard stylesheet served by the fixture host.
 * The view is NOT routed through the fixture host: that needs an edit to integration/fixture-host/main.tsx (outside this
 * task's file scope), so this harness mounts server-rendered markup into the host page. See docs/integration/TD02-enabled-summary.md.
 */
test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external request in synthetic summary harness.'); }
    await route.continue();
  });
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => { if (message.type() === 'error') throw new Error(message.text()); });
});

async function mount(page: Page, result: ProjectionResult<SummaryProjection>, projectLabel?: string) {
  await page.goto('/admin/finance?state=unavailable');
  const html = renderToStaticMarkup(createElement(FinancialSummaryView, projectLabel ? { result, projectLabel } : { result }));
  await page.evaluate((markup) => { document.body.innerHTML = `<main><h1>Financial summary harness</h1>${markup}</main>`; }, html);
}
async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).analyze();
  await writeFile(test.info().outputPath(`${name}-axe.json`), JSON.stringify(results, null, 2));
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}

test('ready summary: exact amounts, unknown and unavailable stay distinct and the page passes axe', async ({ page }) => {
  await mount(page, ready(requestedOf(projection(), ['expense.effective', 'expense.provider_unbilled', 'expense.never_delivered'])), 'Authorized host project');
  await expect(page.getByRole('region', { name: 'Financial summary' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Financial scope' })).toContainText('Authorized host project');
  await expect(page.getByRole('heading', { name: 'expense.effective' }).locator('..')).toContainText('0.000007');
  await expect(page.getByRole('heading', { name: 'expense.provider_unbilled' }).locator('..')).toContainText('Amount unknown');
  await expect(page.getByRole('heading', { name: 'expense.never_delivered' }).locator('..')).toContainText('Amount unavailable');
  await expect(page.getByRole('table', { name: 'Metric provenance' })).toBeVisible();
  await scan(page, 'financial-summary-ready');
});

test('stale summary announces staleness and passes axe', async ({ page }) => {
  await mount(page, stale());
  await expect(page.getByRole('status')).toContainText('older than the host freshness policy');
  await scan(page, 'financial-summary-stale');
});

test('unsupported Finance 0.3.0 packet renders an alert with no amounts and passes axe', async ({ page }) => {
  const result = refuseUnsupportedPacket({ canonicalReferences: { packageVersion: '0.3.0', schemaVersion: '1.0.0', adoptionAccepted: false } })!;
  await mount(page, result);
  await expect(page.getByRole('alert')).toContainText('Unsupported summary contract');
  await expect(page.getByRole('alert')).toContainText('UNSUPPORTED_VERSION');
  await expect(page.getByRole('heading', { level: 3, name: /expense/u })).toHaveCount(0);
  await scan(page, 'financial-summary-unsupported');
});

test('summary content reflows at 320 CSS pixels without horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mount(page, ready(requestedOf(projection(), ['expense.effective'])));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
