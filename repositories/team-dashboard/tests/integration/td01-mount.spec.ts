import { expect, test } from '@playwright/test';
test.beforeEach(async ({ context }) => {
  await context.route('**/*', async (route) => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external fixture request.'); } else await route.continue(); });
});
test('TD-01 packed mount uses injected adapter and labels fixture mode', async ({ page, context }) => {
  const external: string[] = []; const errors: string[] = [];
  await context.route('**/*', async (route) => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); await route.abort(); } else await route.continue(); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/alternate/team/reports/exports?base=/alternate/team&state=ready');
  await expect(page.getByRole('heading', { name: 'Exports', level: 1 })).toBeVisible();
  await expect(page.getByText('Fixture mode — local boundary examples')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connected read-only extension' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Exports', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Budgets', exact: true }).click(); await expect(page).toHaveURL(/\/alternate\/team\/budgets/u);
  await page.screenshot({ path: test.info().outputPath('td01-packed-extension.png'), fullPage: true });
  expect(external).toEqual([]); expect(errors).toEqual([]);
});
test('TD-01 missing host auth, missing port, and unknown routes fail closed', async ({ page }) => {
  await page.goto('/admin/finance?auth=missing&state=ready'); await expect(page.getByText('Access restricted')).toBeVisible();
  await expect(page.getByText('Connected read-only extension')).toHaveCount(0);
  await page.goto('/admin/finance?provider=missing&state=ready'); await expect(page.getByText('Upstream unavailable')).toBeVisible();
  await page.goto('/admin/finance/not-a-route'); await expect(page.getByRole('heading', { name: 'Route not found', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Return to overview' }).click(); await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
});
