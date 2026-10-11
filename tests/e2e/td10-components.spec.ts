import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
async function tabTo(page: Page, target: Locator) {
  for (let step = 0; step < 80; step += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('Keyboard target was unreachable.');
}
async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).analyze();
  await writeFile(test.info().outputPath(`${name}-axe.json`), JSON.stringify(results, null, 2));
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}
test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external request in synthetic component harness.'); }
    await route.continue();
  });
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => { if (message.type() === 'error') throw new Error(message.text()); });
});

test('TD-10 keyboard filter, sort, detail, return focus and report navigation', async ({ page }) => {
  await page.goto('/admin/finance?examples=components');
  await expect(page.getByText('Synthetic UI display samples. These are not producer-approved finance fixtures.')).toBeVisible();
  const filter = page.getByRole('combobox', { name: 'Display sample', exact: true });
  await tabTo(page, filter); await expect(filter).toHaveCSS('outline-style', 'solid'); await expect(filter).toHaveCSS('outline-width', '3px'); await page.keyboard.press('n'); await page.keyboard.press('Enter');
  await expect(filter).toHaveValue('negative');
  await tabTo(page, page.getByRole('link', { name: 'View synthetic record examples' })); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Transactions', level: 1 })).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Display sample', exact: true })).toHaveValue('negative');
  const sort = page.getByRole('button', { name: 'Record · ascending' }); await tabTo(page, sort); await page.keyboard.press('Enter');
  await expect(page.getByRole('columnheader', { name: 'Record · descending' })).toHaveAttribute('aria-sort', 'descending');
  const record = page.getByRole('link', { name: 'Open synthetic negative record' }); await tabTo(page, record); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Transaction detail', level: 1 })).toBeFocused();
  await expect(page.getByText('-12345678901234567890.000000137', { exact: true })).toBeVisible();
  await tabTo(page, page.getByRole('link', { name: 'Return to results' })); await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Open synthetic negative record' })).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Display sample', exact: true })).toHaveValue('negative');
  await expect(page.getByRole('columnheader', { name: 'Record · descending' })).toHaveAttribute('aria-sort', 'descending');
  await expect(page.getByText('Synthetic project / no customer data')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dashboard', exact: true }).getByRole('link', { name: 'Transactions', exact: true })).toHaveAttribute('aria-current', 'page');
  await tabTo(page, page.getByRole('link', { name: 'View synthetic report preview' })); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Synthetic report preview' })).toBeVisible();
  await scan(page, 'keyboard-report');
  await page.screenshot({ path: test.info().outputPath('td10-keyboard-report.png'), fullPage: true });
});

test('TD-10 controlled pagination, empty/restricted rows and exact chart table', async ({ page }) => {
  await page.goto('/admin/finance/transactions?examples=components');
  const table = page.getByRole('table', { name: 'Synthetic records — display examples' });
  await expect(table.getByText('-12345678901234567890.000000137', { exact: true })).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: 'Next page' })); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await expect(table.getByText('Synthetic restricted record')).toBeVisible();
  await expect(table.getByText('0.000000000', { exact: true })).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: 'Previous page' })); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  const alternative = page.getByRole('table', { name: 'Synthetic category display — exact data alternative' });
  await expect(alternative.getByText('0.000000137', { exact: true })).toBeVisible();
  await expect(alternative.getByText('-12345678901234567890.000000137', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Display sample', exact: true }).selectOption('none');
  await expect(page.getByText('No rows to display.')).toBeVisible();
  await expect(page.getByText('No categories to display.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await scan(page, 'empty-results');
});

test('TD-10 tooltip focus, hover, Escape and blur', async ({ page }) => {
  await page.goto('/admin/finance/transactions?examples=components');
  const button = page.getByRole('button', { name: 'Details for Synthetic positive' });
  await tabTo(page, button); await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(button).toHaveAccessibleDescription('Synthetic tooltip. The displayed precision is supplied unchanged.');
  await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.keyboard.press('Tab'); await page.keyboard.press('Escape'); await button.hover(); await expect(page.getByRole('tooltip')).toBeVisible();
  await scan(page, 'hover-tooltip');
  await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.mouse.move(0, 0); await button.hover(); await expect(page.getByRole('tooltip')).toBeVisible();
  await page.mouse.move(0, 0); await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('TD-10 full page axe states, native fallback fonts, narrow/enlarged and reduced motion', async ({ page }) => {
  await page.goto('/admin/finance?examples=components'); await scan(page, 'overview');
  for (const state of ['loading', 'empty', 'error', 'restricted', 'unavailable']) {
    await page.getByRole('combobox', { name: 'Boundary state', exact: true }).selectOption(state);
    await scan(page, `boundary-${state}`);
  }
  await page.getByRole('combobox', { name: 'Boundary state', exact: true }).selectOption('ready');
  await page.setViewportSize({ width: 360, height: 800 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('table', { name: 'Synthetic records — display examples' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('.td-bar').first().evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await scan(page, 'narrow'); await page.screenshot({ path: test.info().outputPath('td10-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.evaluate(() => { document.body.style.zoom = '2'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await scan(page, 'zoom200'); await page.screenshot({ path: test.info().outputPath('td10-zoom200.png'), fullPage: true });
});

test('TD-10 axe negative control detects an unlabeled control then recovers', async ({ page }) => {
  await page.goto('/admin/finance/transactions?examples=components');
  await page.evaluate(() => { const button = document.createElement('button'); button.id = 'axe-negative-control'; document.querySelector('main')!.append(button); });
  const negative = await new AxeBuilder({ page }).analyze();
  await writeFile(test.info().outputPath('negative-control-axe.json'), JSON.stringify(negative, null, 2));
  expect(negative.violations.some((violation) => violation.id === 'button-name')).toBe(true);
  await page.locator('#axe-negative-control').evaluate((element) => element.remove()); await scan(page, 'negative-control-recovered');
});
