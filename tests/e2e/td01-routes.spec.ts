import { expect, test } from '@playwright/test';
import { routes, routeHref } from '../../integration';
test.beforeEach(async ({ context }) => {
  await context.route('**/*', async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external fixture network request.'); }
    await route.continue();
  });
});
for (const entry of routes) test(`TD-01 direct entry and reload: ${entry.id}`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const path = routeHref('/admin/finance', entry.id, { id: 'fixture-record' });
  await page.goto(path); await expect(page.getByRole('heading', { name: entry.label, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upstream unavailable' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: entry.label, level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
test('TD-01 keyboard navigation, focus and history', async ({ page }) => {
  await page.goto('/admin/finance');
  const link = page.getByRole('link', { name: 'AI costs' });
  for (let tab = 0; tab < 6; tab += 1) await page.keyboard.press('Tab');
  await expect(link).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/ai-costs$/u); await expect(page.getByRole('heading', { name: 'AI costs', level: 1 })).toBeFocused();
  await expect(link).toHaveAttribute('aria-current', 'page');
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeFocused();
});
test('TD-01 all states, retry, revocation and no false zero', async ({ page }) => {
  await page.goto('/admin/finance');
  const states = [['loading', 'Loading'], ['empty', 'No records'], ['error', 'Could not load this route'], ['restricted', 'Access restricted'], ['unavailable', 'Upstream unavailable']] as const;
  for (const [state, title] of states) {
    await page.getByLabel('Boundary state').selectOption(state); await expect(page.getByRole('heading', { name: title })).toBeVisible();
    if (state === 'error') { await page.getByRole('button', { name: 'Retry read' }).click(); await expect(page.getByRole('heading', { name: title })).toBeVisible(); }
    await expect(page.getByText(/\$0|0\.00/u)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`td01-${state}.png`), fullPage: true });
  }
  await page.getByLabel('Boundary state').selectOption('ready'); await expect(page.getByRole('heading', { name: 'Connected read-only extension' })).toBeVisible();
  await page.getByLabel('Fixture auth grant').uncheck(); await expect(page.getByText('Access restricted')).toBeVisible();
  await expect(page.getByText('Read-only extension fixture.', { exact: false })).toHaveCount(0);
});
test('TD-01 narrow, 200% zoom and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/admin/finance/transactions/fixture-record');
  await expect(page.getByRole('heading', { name: 'Transaction detail', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('td01-narrow.png'), fullPage: true });
  // Chromium page zoom is represented by the CSS zoom property; test effective doubled layout at desktop width too.
  await page.setViewportSize({ width: 1280, height: 900 }); await page.evaluate(() => { document.body.style.zoom = '2'; });
  await expect(page.getByRole('heading', { name: 'Upstream unavailable' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('td01-zoom200.png'), fullPage: true });
});

test('TD-01 every required route exposes all five boundaries', async ({ page }) => {
  for (const entry of routes) {
    await page.goto(routeHref('/admin/finance', entry.id, { id: 'fixture-record' }));
    for (const [state, heading] of [['loading', 'Loading'], ['empty', 'No records'], ['error', 'Could not load this route'], ['restricted', 'Access restricted'], ['unavailable', 'Upstream unavailable']] as const) {
      await page.getByLabel('Boundary state').selectOption(state);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  }
});
