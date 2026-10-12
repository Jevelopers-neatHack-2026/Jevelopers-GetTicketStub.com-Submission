import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';

/**
 * Real Chromium + axe over the real, hydrated client. The packed dashboard mounts `FinanceV2ConnectedView` from `renderRoute`; the fixture
 * host injects a SYNTHETIC_PROPOSAL read port (data scripted by `?v2port=`) and a host authorization seam. No Finance provider exists, so
 * nothing here is Finance output. The `slow` port deliberately ignores the abort signal so a late answer is real, not simulated by a test hook.
 */
test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external request in synthetic Finance v2 harness.'); }
    await route.continue();
  });
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => { if (message.type() === 'error') throw new Error(message.text()); });
});

const open = (page: Page, path: string, query: string) => page.goto(`/admin/finance/${path}?state=ready&v2=ready&${query}`);
const AMOUNT = /\d\.0{18}/u;
const noAmounts = async (page: Page) => expect(await page.locator('main').innerText()).not.toMatch(AMOUNT);
async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).analyze();
  await writeFile(test.info().outputPath(`${name}-axe.json`), JSON.stringify(results, null, 2));
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}
async function tabTo(page: Page, target: Locator, limit = 300) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let tabs = 0; tabs < limit; tabs += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('Tab alone did not reach the keyboard target.');
}
/** Records every `rev-N` / `actor-x` request tag that ever reaches the DOM, so a flash of a stale answer cannot hide between polls. */
const recordTags = (page: Page) => page.addInitScript(() => {
  const seen = new Set<string>();
  (window as unknown as { __seenTags: Set<string> }).__seenTags = seen;
  const scanText = () => { for (const match of (document.body?.innerText ?? '').matchAll(/rev-\d+|actor-[ab]\b/gu)) seen.add(match[0]); };
  new MutationObserver(scanText).observe(document, { childList: true, subtree: true, characterData: true });
});
const seenTags = (page: Page) => page.evaluate(() => [...(window as unknown as { __seenTags: Set<string> }).__seenTags]);

test('hydrates through the injected port with the host token, and never shows the token or puts it in the URL', async ({ page }) => {
  await open(page, 'budgets', '');
  await expect(page.getByRole('region', { name: 'Budget advisory', exact: true })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('SYNTHETIC_PROPOSAL');
  const calls = await page.evaluate(() => (window as unknown as { __financeV2PortLog: { calls: { token: string; revision: string }[] } }).__financeV2PortLog.calls);
  expect(calls).toEqual([expect.objectContaining({ token: 'fixture-token-1', revision: '1' })]);
  expect(await page.locator('body').innerHTML()).not.toContain('fixture-token');
  expect(page.url()).not.toContain('fixture-token');
  await scan(page, 'finance-v2-async-ready');
});

test('shows loading with no amounts while the port is in flight', async ({ page }) => {
  await open(page, 'budgets', 'v2port=slow');
  await expect(page.getByRole('status').filter({ hasText: 'Loading the report' })).toBeVisible();
  await noAmounts(page);
  await scan(page, 'finance-v2-async-loading');
  await expect(page.getByRole('region', { name: 'Snapshot and scope' })).toBeVisible({ timeout: 5000 });
});

test('an authorization revision change cancels the read and the ignored-abort old answer never reaches the DOM', async ({ page }) => {
  await recordTags(page);
  await open(page, 'budgets', 'v2port=slow');
  await expect(page.getByRole('status').filter({ hasText: 'Loading the report' })).toBeVisible();
  await page.getByRole('button', { name: /Bump Finance v2 authorization revision/u }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading the report' })).toBeVisible();
  await expect(page.getByText('synthetic-request-1:account:synthetic-actor:rev-2')).toBeVisible({ timeout: 6000 });
  // Give the abandoned first request time to resolve; its answer must stay out.
  await page.waitForTimeout(500);
  expect(await seenTags(page)).not.toContain('rev-1');
  expect(await page.evaluate(() => (window as unknown as { __financeV2PortLog: { calls: unknown[] } }).__financeV2PortLog.calls.length)).toBe(2);
});

test('an actor change cancels the read and shows only the new actor', async ({ page }) => {
  await recordTags(page);
  await open(page, 'budgets', 'v2port=slow');
  await expect(page.getByRole('status').filter({ hasText: 'Loading the report' })).toBeVisible();
  await page.getByLabel('Finance v2 actor').selectOption('b');
  await expect(page.getByText('synthetic-request-1:account:synthetic-actor-b:rev-1')).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(500);
  expect(await seenTags(page)).not.toContain('actor-a');
  await expect(page.getByRole('region', { name: 'Snapshot and scope' })).toContainText('account:synthetic-actor-b');
});

test('a settled answer is withdrawn the moment the host revokes the token or availability', async ({ page }) => {
  await open(page, 'budgets', 'v2port=tagged');
  await expect(page.getByRole('region', { name: 'Snapshot and scope' })).toBeVisible();
  await page.getByLabel('Finance v2 host token').uncheck();
  await expect(page.getByRole('alert')).toContainText('not authorized');
  await noAmounts(page);
  await page.getByLabel('Finance v2 host token').check();
  await expect(page.getByRole('region', { name: 'Snapshot and scope' })).toBeVisible();
  await page.getByLabel('Finance v2 host available').uncheck();
  await expect(page.getByRole('status').filter({ hasText: 'restricted for your access' })).toBeVisible();
  await noAmounts(page);
  const calls = await page.evaluate(() => (window as unknown as { __financeV2PortLog: { calls: unknown[] } }).__financeV2PortLog.calls.length);
  expect(calls).toBe(2);
});

for (const [behavior, copy, retryable] of [['fault401', 'not authorized', false], ['fault403', 'restricted for your access', false], ['fault429', 'slow down', true], ['fault500', 'unavailable right now', true], ['timeout', 'did not answer in time', true]] as const) {
  test(`typed ${behavior} fault is shown safely, with no amount and no error text echoed`, async ({ page }) => {
    await open(page, 'budgets', `v2port=${behavior}`);
    await expect(page.locator('main')).toContainText(copy);
    await noAmounts(page);
    expect(await page.locator('main').innerText()).not.toMatch(/fixture fault|fixture timeout|fixture-token/u);
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(retryable ? 1 : 0);
    await scan(page, `finance-v2-async-${behavior}`);
  });
}

test('retry after a transient 5xx recovers using the keyboard only', async ({ page }) => {
  await open(page, 'budgets', 'v2port=flaky');
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  await tabTo(page, retry);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Snapshot and scope' })).toBeVisible();
  await expect(retry).toHaveCount(0);
});

test('a port that never answers times out, offers retry, and shows no amount', async ({ page }) => {
  await open(page, 'budgets', 'v2port=hang&v2timeout=400');
  await expect(page.getByRole('alert')).toContainText('did not answer in time', { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await noAmounts(page);
});

test('no injected port reads unavailable, and integrated mode never falls back to the fixture even with a port on the host', async ({ page }) => {
  await open(page, 'budgets', 'v2port=none');
  await expect(page.getByRole('status').filter({ hasText: 'No Finance v2 read port was provided' })).toBeVisible();
  await noAmounts(page);
  await open(page, 'transactions', 'v2mode=integrated');
  await expect(page.getByRole('status').filter({ hasText: 'no accepted read port exists' })).toBeVisible();
  await noAmounts(page);
  await expect(page.getByText('SYNTHETIC_PROPOSAL')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __financeV2PortLog: { calls: unknown[] } }).__financeV2PortLog.calls.length)).toBe(0);
  await scan(page, 'finance-v2-async-integrated');
});

test('a page for the wrong scope, snapshot or version is refused after the port answers', async ({ page }) => {
  for (const [fixture, code] of [['forged-scope', 'SCOPE_MISMATCH'], ['forged-snapshot', 'SNAPSHOT_MISMATCH'], ['unsupported-version', 'UNSUPPORTED_VERSION']] as const) {
    await page.goto(`/admin/finance/budgets?state=ready&v2=${fixture}`);
    await expect(page.getByRole('alert')).toContainText(code);
    await noAmounts(page);
  }
});

test('the CFO export stays disabled after hydration and nothing downloads', async ({ page }) => {
  await open(page, 'budgets', '');
  await expect(page.getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
  await expect(page.locator('a[download]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'CFO export' })).toContainText('no export success is claimed');
});
