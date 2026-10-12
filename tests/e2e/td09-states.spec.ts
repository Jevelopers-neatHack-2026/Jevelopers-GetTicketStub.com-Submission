import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external request in synthetic state harness.'); }
    await route.continue();
  });
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => { if (message.type() === 'error') throw new Error(message.text()); });
});
async function scan(page: import('@playwright/test').Page, name: string) {
  const results = await new AxeBuilder({ page }).analyze();
  await writeFile(test.info().outputPath(`${name}-axe.json`), JSON.stringify(results, null, 2));
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}

test('TD-09 retryable error keeps keyboard focus and offers a keyboard route out', async ({ page }) => {
  await page.goto('/admin/finance/ai-costs?state=error');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load this route');
  await expect(alert).not.toContainText(/\$|0\.00/u);
  await scan(page, 'td09-error');
  await page.screenshot({ path: test.info().outputPath('td09-error.png') });
  const retry = page.getByRole('button', { name: 'Retry read' });
  await retry.focus(); await page.keyboard.press('Enter');
  await expect(alert).toBeVisible();
  // Focus must remain inside the boundary (or on the replacement button), never fall back to <body>.
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && !!document.activeElement?.closest('.td-boundary'))).toBe(true);
  await page.keyboard.press('Tab');
  const exit = page.getByRole('link', { name: 'Return to overview' });
  await expect(exit).toBeVisible();
  await exit.focus(); await expect(exit).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeFocused();
});

for (const state of ['restricted', 'unavailable', 'empty'] as const) {
  test(`TD-09 ${state} state is distinct, shows no amount and has a safe exit`, async ({ page }) => {
    await page.goto(`/admin/finance/sales?state=${state}`);
    const region = page.locator('.td-boundary');
    await expect(region).toBeVisible();
    await expect(region).not.toContainText(/\$|0\.00/u);
    await expect(region.getByRole('link', { name: 'Return to overview' })).toBeVisible();
    await expect(region.getByRole('button', { name: 'Retry read' })).toHaveCount(0);
    await scan(page, `td09-${state}`);
    await page.screenshot({ path: test.info().outputPath(`td09-${state}.png`) });
  });
}
