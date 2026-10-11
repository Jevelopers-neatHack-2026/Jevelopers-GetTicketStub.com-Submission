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

async function boundedScrollControls(region: Locator) {
  await expect.poll(() => region.evaluate((element) => { const viewport = element.getBoundingClientRect(); const tools = element.querySelector('.td-table-tools')!; return [tools, ...tools.querySelectorAll('button')].every((node) => { const bounds = node.getBoundingClientRect(); return bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1; }); })).toBe(true);
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

for (const sample of ['negative', 'subcent']) {
  test(`TD-10 return restores exact originating ${sample} result`, async ({ page }) => {
    await page.goto('/admin/finance/transactions?examples=components');
    const label = sample === 'negative' ? 'Open synthetic negative record' : 'Open synthetic sub-cent record';
    await tabTo(page, page.getByRole('link', { name: label })); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Transaction detail', level: 1 })).toBeFocused();
    await tabTo(page, page.getByRole('link', { name: 'Return to results' })); await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: label })).toBeFocused();
  });
}
test('TD-10 reloaded detail has safe heading fallback and unknown IDs reveal no sample amount', async ({ page }) => {
  await page.goto('/admin/finance/transactions/subcent-ui-sample?examples=components'); await page.reload();
  await tabTo(page, page.getByRole('link', { name: 'Return to results' })); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Transactions', level: 1 })).toBeFocused();
  for (const path of ['/transactions/not-a-synthetic-record', '/events/subcent-ui-sample']) {
    await page.goto('/admin/finance' + path + '?examples=components');
    await expect(page.getByRole('heading', { name: 'Synthetic record unavailable' })).toBeVisible();
    await expect(page.getByText('-12345678901234567890.000000137', { exact: true })).toHaveCount(0);
    await expect(page.getByText('0.000000137', { exact: true })).toHaveCount(0);
    await scan(page, path.includes('/events/') ? 'unknown-event' : 'unknown-transaction');
    await tabTo(page, page.getByRole('link', { name: 'Return to results' })); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Transactions', level: 1 })).toBeFocused();
  }
});
test('TD-10 narrow tables preserve practical widths and keyboard scrolling exposes every column', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); await page.goto('/admin/finance/transactions?examples=components');
  for (const caption of ['Synthetic records — display examples', 'Synthetic category display — exact data alternative']) {
    const region = page.getByRole('region', { name: caption, exact: true });
    const widths = await region.getByRole('columnheader').evaluateAll((headers) => headers.map((header) => header.getBoundingClientRect().width)); expect(Math.min(...widths)).toBeGreaterThanOrEqual(200);
    const amount = region.getByText('-12345678901234567890.000000137', { exact: true }); await expect(amount).toHaveCSS('white-space', 'nowrap');
    expect(await amount.evaluate((element) => { const amount = element.closest('.td-amount')!.getBoundingClientRect(); const cell = element.closest('td')!.getBoundingClientRect(); return amount.right <= cell.right && amount.left >= cell.left; })).toBe(true);
    const right = page.getByRole('button', { name: `Scroll ${caption} right`, exact: true }); await tabTo(page, right); await expect(right).toHaveCSS('outline-style', 'solid'); await page.keyboard.press('Enter');
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0); await boundedScrollControls(region);
    await page.keyboard.press('End'); await expect(right).toHaveAttribute('aria-disabled', 'true'); await boundedScrollControls(region);
    expect(await region.getByRole('columnheader').last().evaluate((element) => { const bounds = element.getBoundingClientRect(); const viewport = element.closest('.td-table-scroll')!.getBoundingClientRect(); return bounds.left >= viewport.left && bounds.right <= viewport.right; })).toBe(true);
    await region.screenshot({ path: test.info().outputPath(caption.startsWith('Synthetic records') ? 'records-right.png' : 'chart-table-right.png') });
    await page.keyboard.press('Home'); await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBe(0); await boundedScrollControls(region);
    await region.screenshot({ path: test.info().outputPath(caption.startsWith('Synthetic records') ? 'records-left.png' : 'chart-table-left.png') });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await scan(page, 'narrow-scrollable-tables');
  await page.setViewportSize({ width: 1280, height: 900 }); await page.evaluate(() => { document.body.style.zoom = '2'; });
  for (const region of await page.locator('.td-table-scroll').all()) {
    const amount = region.getByText('-12345678901234567890.000000137', { exact: true });
    expect(await amount.evaluate((element) => { const amount = element.closest('.td-amount')!.getBoundingClientRect(); const cell = element.closest('td')!.getBoundingClientRect(); return amount.right <= cell.right && amount.left >= cell.left; })).toBe(true);
    for (const position of ['start', 'middle', 'end']) { await region.evaluate((element, position) => { element.scrollLeft = position === 'start' ? 0 : position === 'end' ? element.scrollWidth : (element.scrollWidth - element.clientWidth) / 2; }, position); await boundedScrollControls(region); }
    await region.evaluate((element) => { element.scrollLeft = (element.querySelector('td .td-amount')!.closest('td') as HTMLElement).offsetLeft; });
  }
  await page.screenshot({ path: test.info().outputPath('amount-state-zoom200.png'), fullPage: true }); await scan(page, 'enlarged-amount-state');
});

test('TD-10 originating result removed by a changed filter falls back to heading', async ({ page }) => {
  await page.goto('/admin/finance/transactions?examples=components');
  await tabTo(page, page.getByRole('link', { name: 'Open synthetic negative record' })); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Transaction detail', level: 1 })).toBeFocused();
  await page.evaluate(() => { const url = new URL(window.location.href); url.searchParams.set('sample', 'none'); window.history.replaceState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); });
  await tabTo(page, page.getByRole('link', { name: 'Return to results' })); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Transactions', level: 1 })).toBeFocused(); await expect(page.getByText('No rows to display.')).toBeVisible();
});
