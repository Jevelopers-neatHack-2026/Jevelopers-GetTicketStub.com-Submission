import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * SYNTHETIC_CONFORMANCE_ONLY. Real Chromium + axe over the real, hydrated client (no SSR shortcut). The fixture host injects a read port that serves the ACTUAL captured Finance-producer
 * pagination chain (3 pages, 6 ordered unique details, 9 typed refusals; committed byte for byte) by looking up the recorded answer to the exact recorded query. It is a presentation
 * fixture, not live Finance: the captured cursors cannot be replayed against anything. Nothing here is a grant, real billing evidence, a consumer ACK or export adoption.
 */
test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external request in synthetic Finance v2 conformance harness.'); }
    await route.continue();
  });
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => { if (message.type() === 'error') throw new Error(message.text()); });
});

const DIR = 'tests/fixtures/finance-v2-pagination-conformance/';
const PINS = { 'producer-v2-pagination-page.json': '0b69c52a47e13cb181c0abcf388a15753ed9673dc74b583da0a0d305330e4423', 'producer-v2-refusals-page.json': 'eefdaa7f7f55ce9f5340d63e0fe527a63dd12126f9ccf030b950af6fbfe74953' } as const;
const read = (name: keyof typeof PINS) => {
  const data = readFileSync(DIR + name);
  expect(createHash('sha256').update(data).digest('hex')).toBe(PINS[name]);
  return JSON.parse(data.toString('utf8')) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const capture = read('producer-v2-pagination-page.json');
const refusals = read('producer-v2-refusals-page.json');
const IDS: string[] = capture.orderedDetailIds;
const CURSOR_2: string = capture.pages[0].response.nextCursor;
const CURSOR_3: string = capture.pages[1].response.nextCursor;
const observation = (name: string) => refusals.observations.find((entry: { name: string }) => entry.name === name);

const open = (page: Page, query = '', path = 'transactions') => page.goto(`/admin/finance/${path}?state=ready&v2=conformance-pagination&v2port=captured${query ? `&${query}` : ''}`);
const AMOUNT = /\d+(\.\d+)? (USD|EUR)/u;
const noAmounts = async (page: Page) => expect(await page.locator('main').innerText()).not.toMatch(AMOUNT);
const pageStatus = (page: Page, label: string) => page.getByRole('navigation', { name: 'Transaction pages' }).getByRole('status').filter({ hasText: label });
const readsLog = (page: Page) => page.evaluate(() => (window as unknown as { __financeV2CapturedLog: { reads: { page: number | null; pageSize: number | null; outcome: string; code: string | null; revision: string }[] } }).__financeV2CapturedLog.reads);
const answered = async (page: Page) => (await readsLog(page)).map((entry) => entry.page);
const rows = (page: Page) => page.getByRole('table', { name: 'Transaction details' }).getByRole('rowheader').allTextContents();
const heading = (page: Page) => page.getByRole('heading', { level: 2, name: 'Transaction drilldown' });
const banner = (page: Page) => page.getByRole('region', { name: 'Snapshot and scope' }).innerText();
async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).analyze();
  await writeFile(test.info().outputPath(`${name}-axe.json`), JSON.stringify(results, null, 2));
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}
/** Real keyboard only: Tab from the document start until `target` is the active element. */
async function tabTo(page: Page, target: Locator, limit = 300) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let tabs = 0; tabs < limit; tabs += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('Tab alone did not reach the keyboard target.');
}
/** Nothing the producer or host kept private may reach the page: no raw safe_message, diagnostic reference, cursor or token. */
async function expectNoLeak(page: Page) {
  const html = await page.locator('body').innerHTML();
  const secrets: string[] = [CURSOR_2, CURSOR_3, 'fixture-token', ...refusals.observations.flatMap((entry: any) => [entry.result.error.safe_message, entry.result.error.diagnostic_ref, entry.request.cursor ?? '']).filter(Boolean)]; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const secret of secrets) expect(html, secret.slice(0, 40)).not.toContain(secret);
}
const recordIds = (page: Page, prefixes: string[]) => page.addInitScript((wanted) => {
  const seen = new Set<string>();
  (window as unknown as { __seenIds: Set<string> }).__seenIds = seen;
  const scanText = () => { for (const match of (document.body?.innerText ?? '').matchAll(/sha256:[0-9a-f]{64}/gu)) if (wanted.some((prefix) => match[0].startsWith(prefix))) seen.add(match[0]); };
  new MutationObserver(scanText).observe(document, { childList: true, subtree: true, characterData: true });
}, prefixes);
const seenIds = (page: Page) => page.evaluate(() => [...(window as unknown as { __seenIds: Set<string> }).__seenIds]);

test('three actual pages by keyboard alone: exact ordered ids, replaced rows, delivered summary unchanged, focus on the heading, axe clean', async ({ page }) => {
  await open(page);
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  expect(await rows(page)).toEqual([IDS[0], IDS[1]]);
  await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('2 EUR');
  const summary = await banner(page);
  await scan(page, 'pagination-conformance-page-1');
  const nextButton = page.getByRole('button', { name: 'Next page' });
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await tabTo(page, nextButton); await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H2');
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  expect(await rows(page)).toEqual([IDS[2], IDS[3]]);
  await expect(page.getByRole('table', { name: 'Transaction details' })).toContainText('0.000000000000000001 USD');
  expect(await banner(page)).toBe(summary);
  await scan(page, 'pagination-conformance-page-2');
  await tabTo(page, nextButton); await page.keyboard.press('Space');
  await expect(pageStatus(page, 'Page 3')).toBeVisible();
  expect(await rows(page)).toEqual([IDS[4], IDS[5]]);
  expect(await banner(page)).toBe(summary);
  await expect(nextButton).toBeDisabled();
  await expect(page.getByRole('main')).toContainText('Rows on this page only');
  await scan(page, 'pagination-conformance-page-3');
  await tabTo(page, page.getByRole('button', { name: 'Previous page' })); await page.keyboard.press('Enter');
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  expect(await rows(page)).toEqual([IDS[2], IDS[3]]);
  expect(await answered(page)).toEqual([null, 1, 2, 1]);
  expect((await readsLog(page)).every((entry) => entry.outcome === 'ready' && entry.pageSize === 2)).toBe(true);
  await expectNoLeak(page);
  expect(page.url()).not.toContain('fixture-token');
});

test('reload keeps the actual cursor as request metadata only, labels the position honestly, and Previous returns to the first page', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  expect(page.url()).toContain(`cursor=${encodeURIComponent(CURSOR_2)}`);
  await page.reload();
  await expect(pageStatus(page, 'Linked page')).toBeVisible();
  expect(await rows(page)).toEqual([IDS[2], IDS[3]]);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  expect(await rows(page)).toEqual([IDS[0], IDS[1]]);
  expect(page.url()).not.toContain('cursor=');
  await expectNoLeak(page);
});

test('Back from a transaction opened on page 2 returns to that page, read again from the live URL cursor', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await page.getByRole('link', { name: IDS[2]! }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Transaction detail view' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Transaction record' })).toContainText(IDS[2]!);
  await page.goBack();
  await expect(pageStatus(page, 'Linked page')).toBeVisible();
  expect(await rows(page)).toEqual([IDS[2], IDS[3]]);
});

test('a filter change on page 2 returns to the first page, drops the history and reads fresh', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await page.getByLabel('Currency').selectOption('USD');
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  expect(await rows(page)).toEqual([IDS[1]]);
  expect(page.url()).not.toContain('cursor=');
  expect(await answered(page)).toEqual([null, 1, null]);
});

test('an actor change while page 2 is in flight cancels it, and the ignored-abort late actual answer never reaches the DOM', async ({ page }) => {
  await recordIds(page, [IDS[2]!.slice(0, 15), IDS[3]!.slice(0, 15)]);
  await open(page, 'v2delay=1500');
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading the report' })).toBeVisible();
  await noAmounts(page);
  await page.getByLabel('Finance v2 actor').selectOption('b');
  await expect(page.getByRole('heading', { name: 'Report restricted' })).toBeVisible();
  await page.waitForTimeout(1900);
  expect(await seenIds(page)).toEqual([]);
  await noAmounts(page);
  await expectNoLeak(page);
});

test('revoking the host token on page 2 withdraws it at once, and a regrant reads the first page again', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await page.getByLabel('Finance v2 host token').uncheck();
  await expect(page.getByRole('alert')).toContainText('not authorized');
  await noAmounts(page);
  await page.getByLabel('Finance v2 host token').check();
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  expect(await rows(page)).toEqual([IDS[0], IDS[1]]);
  await expectNoLeak(page);
});

test('an authorization revision change on page 2 returns to the first page with a fresh read', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await page.getByRole('button', { name: /Bump Finance v2 authorization revision/u }).click();
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  expect((await readsLog(page)).map((entry) => [entry.page, entry.revision])).toEqual([[null, '1'], [1, '1'], [null, '2']]);
});

test('a producer revocation after the first page is committed refuses the next page with no amount and no fallback to page 1', async ({ page }) => {
  await open(page, 'v2grant=revoked');
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible();
  await noAmounts(page);
  await expect(page.getByRole('table', { name: 'Transaction details' })).toHaveCount(0);
  expect((await readsLog(page)).map((entry) => entry.code)).toEqual([null, 'FORBIDDEN_SCOPE']);
  await expectNoLeak(page);
});

// Nine actual typed refusals, each replayed through the real hydrated client as the recorded query. A foreign scope reads as restricted; a lost CURRENT grant as unauthorized.
const FORGED = observation('unsigned_cursor_forgery').request.cursor as string;
const SIZE_MISMATCH = observation('cursor_page_size_mismatch').request.cursor as string;
const REFUSAL_CASES: ReadonlyArray<readonly [string, string, string, string]> = [
  ['unsigned_cursor_forgery', `cursor=${encodeURIComponent(FORGED)}`, 'Report could not be loaded', 'VALIDATION_ERROR'],
  ['cursor_page_size_mismatch', `cursor=${encodeURIComponent(SIZE_MISMATCH)}&v2size=3`, 'Report could not be loaded', 'IDEMPOTENCY_CONFLICT'],
  ['snapshot_period_mismatch', 'v2tamper=period', 'Report could not be loaded', 'IDEMPOTENCY_CONFLICT'],
  ['snapshot_filter_mismatch', 'v2tamper=filters', 'Report could not be loaded', 'IDEMPOTENCY_CONFLICT'],
  ['foreign_scope', 'v2scope=foreign', 'Report restricted', 'FORBIDDEN_SCOPE'],
  ['cross_version_snapshot', 'v2tamper=version', 'Report could not be loaded', 'IDEMPOTENCY_CONFLICT'],
  ['current_grant_denied', 'v2grant=denied', 'Not authorized', 'FORBIDDEN_SCOPE'],
  ['stale_current_grant', 'v2grant=stale', 'Not authorized', 'FORBIDDEN_SCOPE'],
];
for (const [name, query, title, code] of REFUSAL_CASES) {
  test(`actual refusal ${name} (${code}) shows "${title}" with no amount, no Retry and nothing the producer kept private`, async ({ page }) => {
    await open(page, query);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await noAmounts(page);
    await expect(page.getByRole('table', { name: 'Transaction details' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    expect((await readsLog(page)).map((entry) => entry.code)).toEqual([code]);
    await expectNoLeak(page);
    await scan(page, `pagination-conformance-refusal-${name}`);
  });
}

test('a URL cursor the producer never signed is not authority: no amount and no fallback, and the way back is the first page', async ({ page }) => {
  await open(page, 'cursor=not-a-signed-cursor');
  await expect(page.getByRole('heading', { name: 'Report could not be loaded' })).toBeVisible();
  await noAmounts(page);
  await page.getByRole('button', { name: 'Return to first page' }).click();
  await expect(pageStatus(page, 'Page 1')).toBeVisible();
  expect(page.url()).not.toContain('cursor=');
});

test('an empty URL cursor is refused before any read, not turned into a first-page read', async ({ page }) => {
  await open(page, 'cursor=');
  await expect(page.getByRole('alert')).toContainText('/cursor');
  await noAmounts(page);
  expect(await readsLog(page)).toEqual([]);
});

test('INTEGRATED mode with an actual cursor stays unavailable and never reads', async ({ page }) => {
  await open(page, `v2mode=integrated&cursor=${encodeURIComponent(CURSOR_2)}`);
  await expect(page.getByRole('status').filter({ hasText: 'no accepted read port exists' })).toBeVisible();
  await noAmounts(page);
  await expect(page.getByRole('navigation', { name: 'Transaction pages' })).toHaveCount(0);
  expect(await readsLog(page)).toEqual([]);
});

test('the CFO export stays disabled on every actual page', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
  await expect(page.locator('a[download]')).toHaveCount(0);
  await expect(heading(page)).toBeVisible();
});

test('the loaded actual page 2 reflows at 320 CSS pixels without page-level horizontal scroll, and its table scroll is keyboard reachable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageStatus(page, 'Page 2')).toBeVisible();
  expect(await rows(page)).toEqual([IDS[2], IDS[3]]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  const viewport = page.getByRole('region', { name: 'Transaction details', exact: true });
  const right = page.getByRole('button', { name: 'Scroll Transaction details right' });
  await expect(right, 'the table must really overflow at 320px for this journey to apply').toBeVisible();
  expect(await viewport.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(true);
  await tabTo(page, right);
  await expect(right).toBeFocused();
  await page.keyboard.press('End');
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('Home');
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(0);
  await scan(page, 'pagination-conformance-page-2-320');
});
