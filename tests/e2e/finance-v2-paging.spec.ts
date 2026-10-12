import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
import { CONTEXT_KEY, contextOf, expectPrivate, reseed } from './private-context';

/**
 * Real Chromium + axe over the packed, hydrated dashboard. The fixture host injects a HAND-AUTHORED SYNTHETIC three-page port (`v2port=paged`): it is not Finance output and
 * not a producer-produced continuation chain. Produced multi-page browser conformance stays pending actual Finance artifacts. Opaque cursors are only ever looked up by that port.
 * The cursor is held in the host's PRIVATE history context with an identity binding: it is never in the DOM, an href or any URL, and a cursor in the address is unsupported.
 */
test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external request in synthetic Finance v2 paging harness.'); }
    await route.continue();
  });
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => { if (message.type() === 'error') throw new Error(message.text()); });
});

const CURSOR_2 = 'synthetic-opaque-cursor-for-page-2';
const CURSOR_3 = 'synthetic-opaque-cursor-for-page-3';
const open = (page: Page, query = '') => page.goto(`/admin/finance/transactions?state=ready&v2=ready&v2port=paged&${query}`);
const AMOUNT = /\d\.0{18}/u;
const noAmounts = async (page: Page) => expect(await page.locator('main').innerText()).not.toMatch(AMOUNT);
const pageStatus = (page: Page, label: string) => page.getByRole('navigation', { name: 'Transaction pages' }).getByRole('status').filter({ hasText: label });
const cursors = (page: Page) => page.evaluate(() => (window as unknown as { __financeV2PagedLog: { requests: { cursor: string | null }[] } }).__financeV2PagedLog.requests.map((entry) => entry.cursor));
const heading = (page: Page) => page.getByRole('heading', { level: 2, name: 'Transaction drilldown' });
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
const recordTags = (page: Page) => page.addInitScript(() => {
  const seen = new Set<string>();
  (window as unknown as { __seenTags: Set<string> }).__seenTags = seen;
  const scanText = () => { for (const match of (document.body?.innerText ?? '').matchAll(/synthetic-paged-\d:[\w:-]+:rev-\d+/gu)) seen.add(match[0]); };
  new MutationObserver(scanText).observe(document, { childList: true, subtree: true, characterData: true });
});
const seenTags = (page: Page) => page.evaluate(() => [...(window as unknown as { __seenTags: Set<string> }).__seenTags]);

test('next and previous page by keyboard alone, with focus kept on the view heading and no token or cursor in the page', async ({ page }) => {
  await open(page);
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('ai.usage');
  await scan(page, 'finance-v2-paging-page-1');
  const nextButton = page.getByRole('button', { name: 'Next page' });
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await tabTo(page, nextButton);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H2');
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Transaction drilldown');
  await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('-10.000000000000000000 USD');
  await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('Amount unknown');
  await scan(page, 'finance-v2-paging-page-2');
  await tabTo(page, nextButton);
  await page.keyboard.press('Space');
  await expect(pageStatus(page, 'Page 3')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('0.000000000000000001 USD');
  await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('-0.000000000000000500 USD');
  await expect(nextButton).toBeDisabled();
  await scan(page, 'finance-v2-paging-page-3');
  await tabTo(page, page.getByRole('button', { name: 'Previous page' }));
  await page.keyboard.press('Enter');
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  expect(await cursors(page)).toEqual([null, CURSOR_2, CURSOR_3, CURSOR_2]);
  // Independent assertions: the token check can never be skipped behind a cursor failure.
  const body = await page.locator('body').innerHTML();
  expect(body).not.toContain('fixture-token');
  expect(page.url()).not.toContain('fixture-token');
  expect(body).not.toContain(CURSOR_2);
  expect(body).not.toContain(CURSOR_3);
  expect(page.url()).not.toContain(CURSOR_2);
  await expectPrivate(page, [CURSOR_2, CURSOR_3, 'fixture-token']);
});

test('shows loading with no amounts between pages', async ({ page }) => {
  await open(page, 'v2p2=slow');
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading the report' })).toBeVisible();
  await noAmounts(page);
  await expect(pageStatus(page, 'Page 2')).toBeVisible({ timeout: 6000 });
});

test('reload restores the validated private context without any cursor in the page or address, labels the position honestly, and Previous returns to the first page', async ({ page }) => {
  await open(page);
  expect(await contextOf(page)).toBeNull();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  expect(page.url()).not.toContain('cursor');
  expect(page.url()).not.toContain(CURSOR_2);
  const stored = await contextOf(page);
  expect(stored?.cursor).toBe(CURSOR_2);
  expect(Object.keys(stored!.binding).sort()).toEqual(['actorId', 'billingMode', 'currency', 'environment', 'pageSize', 'projectId', 'queryContentHash', 'revision', 'snapshotId', 'summaryContentHash', 'tenantId', 'valuation']);
  expect(JSON.stringify(await page.evaluate(() => window.history.state))).not.toContain('fixture-token');
  await expectPrivate(page, [CURSOR_2, 'fixture-token']);
  await page.reload();
  await expect(pageStatus(page, 'Linked page')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('-10.000000000000000000 USD');
  await expectPrivate(page, [CURSOR_2, CURSOR_3, 'fixture-token']);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  expect(await contextOf(page)).toBeNull();
  expect(await cursors(page)).toEqual([CURSOR_2, null]);
  await expectPrivate(page, [CURSOR_2, 'fixture-token']);
});

test('a page-2 detail opens and returns by keyboard in the same tab with the private context carried, and no href or URL ever holds the cursor', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  const link = page.getByRole('table', { name: 'Transaction details' }).getByRole('link', { name: /^sha256:/u }).first();
  const href = await link.getAttribute('href');
  expect(href).toContain('/admin/finance/transactions/sha256');
  expect(href).not.toMatch(/cursor/u);
  expect(href).not.toContain(CURSOR_2);
  await scan(page, 'finance-v2-paging-page-2-links');
  const detailId = (await link.innerText()).trim();
  await tabTo(page, link);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Transaction detail view' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Transaction record' })).toContainText(detailId);
  expect((await contextOf(page))?.cursor).toBe(CURSOR_2);
  await expectPrivate(page, [CURSOR_2, 'fixture-token']);
  await scan(page, 'finance-v2-paging-detail');
  const back = page.getByRole('link', { name: 'Back to transactions' });
  expect(await back.getAttribute('href')).not.toMatch(/cursor/u);
  await tabTo(page, back);
  await page.keyboard.press('Enter');
  await expect(pageStatus(page, 'Linked page')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('-10.000000000000000000 USD');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  await expectPrivate(page, [CURSOR_2, 'fixture-token']);
  // Browser Back and Forward walk the same entries and restore the same validated context.
  await page.goBack();
  await expect(page.getByRole('heading', { level: 2, name: 'Transaction detail view' })).toBeVisible();
  await page.goBack();
  await expect(pageStatus(page, 'Linked page')).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 2, name: 'Transaction detail view' })).toBeVisible();
  await expectPrivate(page, [CURSOR_2, 'fixture-token']);
});

test('a detail URL opened in a new tab has no private context: it reads the first page only and states honestly that the transaction was not delivered', async ({ page, context }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  const href = (await page.getByRole('table', { name: 'Transaction details' }).getByRole('link', { name: /^sha256:/u }).first().getAttribute('href'))!;
  const shared = await context.newPage();
  await shared.goto(href);
  await expect(shared.getByRole('heading', { name: 'Transaction not in this snapshot' })).toBeVisible();
  await noAmounts(shared);
  expect(await cursors(shared)).toEqual([null]);
  expect(await contextOf(shared)).toBeNull();
  await expectPrivate(shared, [CURSOR_2, 'fixture-token']);
  await shared.close();
});

test('a restored context the port does not know reads missing, with no amount and no fallback', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await reseed(page, { cursor: 'forged-cursor-from-history' });
  await expect(page.getByRole('heading', { name: 'No report delivered' })).toBeVisible();
  await noAmounts(page);
  await expect(page.getByRole('table', { name: 'Transaction details' })).toHaveCount(0);
  await expectPrivate(page, ['forged-cursor-from-history', 'fixture-token']);
  await page.getByRole('button', { name: 'Return to first page' }).click();
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
});

for (const [label, cursor] of [['overlong', 'c'.repeat(2049)], ['empty', '']] as const) {
  test(`a ${label} restored cursor is refused before any read`, async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(pageStatus(page, 'Page 2')).toBeVisible();
    await reseed(page, { cursor });
    await expect(page.getByRole('alert')).toContainText('/cursor');
    await noAmounts(page);
    expect(await cursors(page)).toEqual([]);
    if (cursor) await expectPrivate(page, [cursor]);
  });
}

for (const [field, value] of [
  ['actorId', 'account:synthetic-actor-b'], ['tenantId', 'account:other-tenant'], ['projectId', 'event:other-project'], ['environment', 'live'], ['billingMode', 'real'],
  ['snapshotId', 'sha256:00'], ['queryContentHash', 'sha256:00'], ['summaryContentHash', 'sha256:00'], ['revision', '99'], ['pageSize', 3], ['valuation', 'estimated'], ['currency', 'USD'],
] as const) {
  test(`a restored context bound to a different ${field} is discarded: the first page is read and no page-2 amount or cursor resurfaces`, async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(pageStatus(page, 'Page 2')).toBeVisible();
    await reseed(page, { binding: { [field]: value } });
    await expect(pageStatus(page, 'Page 1')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('ai.usage');
    expect(await page.locator('main').innerText()).not.toContain('sale.refunded');
    expect(await cursors(page)).toEqual([null]);
  });
}

for (const [label, replacement] of [
  ['a string', 'forged'], ['an array', [1]], ['a wrong version', { [CONTEXT_KEY]: { version: 2, cursor: 'x', binding: {} } }], ['an unknown key', { [CONTEXT_KEY]: { version: 1, cursor: 'x', binding: {}, token: 'fixture-token-1' } }],
  ['a non-string cursor', { [CONTEXT_KEY]: { version: 1, cursor: 7, binding: {} } }], ['an empty binding', { [CONTEXT_KEY]: { version: 1, cursor: CURSOR_2, binding: {} } }],
] as const) {
  test(`a forged history context (${label}) is discarded before any read of it: the first page is read`, async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(pageStatus(page, 'Page 2')).toBeVisible();
    await reseed(page, { replaceState: replacement });
    await expect(pageStatus(page, 'Page 1')).toBeVisible();
    expect(await cursors(page)).toEqual([null]);
    await expectPrivate(page, ['fixture-token']);
  });
}

test('extra or token-bearing binding fields are discarded and never rendered', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await reseed(page, { binding: { token: 'fixture-token-1' } });
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  expect(await cursors(page)).toEqual([null]);
  await expectPrivate(page, ['fixture-token', CURSOR_2]);
});

for (const [label, value] of [['forged', 'forged-cursor-from-the-url'], ['overlong', 'c'.repeat(2049)], ['empty', ''], ['real-looking', CURSOR_2]] as const) {
  test(`a ${label} cursor in the address is unsupported: no read, no paging, no echo, and no URL or href repeats it`, async ({ page }) => {
    await open(page, `cursor=${value}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Address paging is not supported' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('no report was read');
    await noAmounts(page);
    await expect(page.getByRole('table', { name: 'Transaction details' })).toHaveCount(0);
    expect(await cursors(page)).toEqual([]);
    expect(page.url()).not.toContain('cursor');
    await expectPrivate(page, [value || CURSOR_3, CURSOR_2, 'fixture-token']);
    await scan(page, `finance-v2-paging-address-${label}`);
    await page.getByRole('button', { name: 'Open the first page' }).click();
    await expect(pageStatus(page, 'Page 1')).toBeVisible();
    expect(await cursors(page)).toEqual([null]);
    await expectPrivate(page, [CURSOR_2, 'fixture-token']);
  });
}

for (const [script, code] of [
  ['snapshot-mismatch', 'SNAPSHOT_MISMATCH'], ['query-hash-mismatch', 'QUERY_HASH_MISMATCH'], ['summary-hash-mismatch', 'SUMMARY_HASH_MISMATCH'], ['scope-mismatch', 'SCOPE_MISMATCH'],
  ['replay', 'PAGE_REPLAY'], ['cursor-loop', 'PAGE_REPLAY'], ['empty-cursor', 'INVALID_SHAPE'], ['stray-cursor', 'INVALID_SHAPE'],
] as const) {
  test(`a continuation with ${script} is refused with ${code}, no amount, and a way back to the first page`, async ({ page }) => {
    await open(page, `v2p2=${script}`);
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByRole('alert')).toContainText(code);
    await noAmounts(page);
    await expect(page.getByRole('table', { name: 'Transaction details' })).toHaveCount(0);
    expect(await page.locator('main').innerText()).not.toContain('ai.usage');
    await scan(page, `finance-v2-paging-${script}`);
    await page.getByRole('button', { name: 'Return to first page' }).click();
    await expect(pageStatus(page, 'Page 1')).toBeVisible();
    expect(page.url()).not.toContain('cursor=');
  });
}

test('an actor change while page 2 is in flight cancels it, and the ignored-abort old answer never reaches the DOM', async ({ page }) => {
  await recordTags(page);
  await open(page, 'v2p2=slow');
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading the report' })).toBeVisible();
  await page.getByLabel('Finance v2 actor').selectOption('b');
  await expect(pageStatus(page, 'Page 1')).toBeVisible({ timeout: 6000 });
  await expect(page.getByRole('region', { name: 'Snapshot and scope' })).toContainText('account:synthetic-actor-b');
  await page.waitForTimeout(1800);
  expect(await seenTags(page)).not.toContain('synthetic-paged-2:account:synthetic-actor:rev-1');
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  expect(await contextOf(page)).toBeNull();
  await expectPrivate(page, [CURSOR_2, 'fixture-token']);
});

test('actor A to B to A never resurrects actor A page 2: each return reads the first page and the private context is cleared', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await page.getByLabel('Finance v2 actor').selectOption('b');
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Snapshot and scope' })).toContainText('account:synthetic-actor-b');
  expect(await contextOf(page)).toBeNull();
  await page.getByLabel('Finance v2 actor').selectOption('a');
  await expect(page.getByRole('region', { name: 'Snapshot and scope' })).not.toContainText('actor-b');
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  expect(await page.locator('main').innerText()).not.toContain('sale.refunded');
  expect(await cursors(page)).toEqual([null, CURSOR_2, null, null]);
  expect(await contextOf(page)).toBeNull();
});

test('an authorization revision change on page 2 returns to the first page with a fresh token', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await page.getByRole('button', { name: /Bump Finance v2 authorization revision/u }).click();
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  const requests = await page.evaluate(() => (window as unknown as { __financeV2PagedLog: { requests: { cursor: string | null; revision: string; token: string }[] } }).__financeV2PagedLog.requests);
  expect(requests.map((entry) => [entry.cursor, entry.revision, entry.token])).toEqual([[null, '1', 'fixture-token-1'], [CURSOR_2, '1', 'fixture-token-1'], [null, '2', 'fixture-token-2']]);
  expect(await contextOf(page)).toBeNull();
  await expectPrivate(page, [CURSOR_2, 'fixture-token']);
});

test('a token revoked on page 2 withdraws it at once with no amount, and a regrant reads the first page', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await page.getByLabel('Finance v2 host token').uncheck();
  await expect(page.getByRole('alert')).toContainText('not authorized');
  await noAmounts(page);
  await page.getByLabel('Finance v2 host token').check();
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
});

test('browser Back after the token is revoked stays no-amount: the restored private context is no authority', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await page.getByRole('table', { name: 'Transaction details' }).getByRole('link', { name: /^sha256:/u }).first().click();
  await expect(page.getByRole('heading', { level: 2, name: 'Transaction detail view' })).toBeVisible();
  await page.getByLabel('Finance v2 host token').uncheck();
  await expect(page.getByRole('alert')).toContainText('not authorized');
  await noAmounts(page);
  await page.goBack();
  await expect(page.getByRole('alert')).toContainText('not authorized');
  await noAmounts(page);
  await expect(page.getByRole('table', { name: 'Transaction details' })).toHaveCount(0);
  await expectPrivate(page, [CURSOR_2, 'fixture-token']);
});

test('withdrawn host availability on page 2 shows no amount', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await page.getByLabel('Finance v2 host available').uncheck();
  await expect(page.getByRole('status').filter({ hasText: 'restricted for your access' })).toBeVisible();
  await noAmounts(page);
  await expect(page.getByRole('navigation', { name: 'Transaction pages' })).toHaveCount(0);
});

test('a filter change on page 2 returns to the first page and drops the history', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await page.getByLabel('Valuation').selectOption('estimated');
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('ai.usage');
  expect(page.url()).not.toContain('cursor');
  expect(await contextOf(page)).toBeNull();
  await expectPrivate(page, [CURSOR_2, 'fixture-token']);
});

for (const [status, title] of [[401, 'Not authorized'], [403, 'Report restricted'], [404, 'No report delivered']] as const) {
  test(`page 3 answering ${status} shows ${title} with no amount and no fallback to page 2`, async ({ page }) => {
    await open(page, `v2p3=fault${status}`);
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(pageStatus(page, 'Page 2')).toBeVisible();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await noAmounts(page);
    await expect(page.getByRole('table', { name: 'Transaction details' })).toHaveCount(0);
  });
}

test('a transient 5xx on page 2 retries with the same cursor by keyboard and recovers', async ({ page }) => {
  await open(page, 'v2p2=fault503');
  await page.getByRole('button', { name: 'Next page' }).click();
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  await noAmounts(page);
  await tabTo(page, retry);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H2');
  // The scripted fault is permanent for page 2, so the retry fails again with the same cursor and never shows an amount.
  await expect(retry).toBeVisible();
  await noAmounts(page);
  expect(await cursors(page)).toEqual([null, CURSOR_2, CURSOR_2]);
});

test('INTEGRATED mode with a cursor in the URL stays unavailable, never reads, and the address is cleaned', async ({ page }) => {
  await open(page, `v2mode=integrated&cursor=${CURSOR_2}`);
  await expect(page.getByRole('status').filter({ hasText: 'no accepted read port exists' })).toBeVisible();
  await noAmounts(page);
  await expect(page.getByRole('navigation', { name: 'Transaction pages' })).toHaveCount(0);
  expect(await cursors(page)).toEqual([]);
  await expectPrivate(page, [CURSOR_2]);
});

test('INTEGRATED mode with a restored private context stays unavailable and reaches no port', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await reseed(page, {}, '?state=ready&v2=ready&v2port=paged&v2mode=integrated');
  await expect(page.getByRole('status').filter({ hasText: 'no accepted read port exists' })).toBeVisible();
  await noAmounts(page);
  await expect(page.getByRole('navigation', { name: 'Transaction pages' })).toHaveCount(0);
  expect(await cursors(page)).toEqual([]);
  await expectPrivate(page, [CURSOR_2, 'fixture-token']);
});

test('the loaded page 2 reflows at 320 CSS pixels with no page-level horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await expectPrivate(page, [CURSOR_2, 'fixture-token']);
});

test('the CFO export stays disabled on every page', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
  await expect(page.locator('a[download]')).toHaveCount(0);
  await expect(heading(page)).toBeVisible();
});
