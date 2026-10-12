import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';

/**
 * SYNTHETIC_CONFORMANCE_ONLY. Real Chromium + axe over the real, hydrated client (no SSR shortcut): the packed dashboard mounts
 * `FinanceV2ConnectedView` from `renderRoute` and the fixture host serves the actual produced pages through its injected synthetic read port.
 * Nothing here is live Finance data, a grant, an owner ACK or a production acknowledgement.
 */
test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external request in synthetic Finance v2 harness.'); }
    await route.continue();
  });
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => { if (message.type() === 'error') throw new Error(message.text()); });
});

const open = (page: Page, path: string, fixture: string, query = '') => page.goto(`/admin/finance/${path}?state=ready&v2=${fixture}${query}`);
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const AMOUNT = /\d+(\.\d+)? (USD|EUR)/u;
const noAmounts = async (page: Page) => expect(await page.locator('main').innerText()).not.toMatch(AMOUNT);
const cells = async (row: Locator) => row.getByRole('cell').allTextContents();
async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).analyze();
  await writeFile(test.info().outputPath(`${name}-axe.json`), JSON.stringify(results, null, 2));
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}
/** Real keyboard only: Tab from the document start until `target` is the active element. No `.focus()` surrogate. */
async function tabTo(page: Page, target: Locator, limit = 300) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let tabs = 0; tabs < limit; tabs += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('Tab alone did not reach the keyboard target.');
}
const portCalls = (page: Page) => page.evaluate(() => (window as unknown as { __financeV2PortLog: { calls: { token: string; revision: string }[] } }).__financeV2PortLog.calls);

test('conformance-unknown-simulated hydrates simulated expense as partial / 5 USD / Amount unknown / 1 beside an unknown actual expense', async ({ page }) => {
  await open(page, 'ai-costs', 'conformance-unknown-simulated');
  await expect(page.getByRole('note')).toContainText('Synthetic data only');
  await expect(page.getByRole('note')).toContainText('not a production acknowledgement');
  const simulated = region(page, 'USD simulated').getByRole('table', { name: 'USD simulated amounts' });
  expect(await cells(simulated.getByRole('rowheader', { name: 'Simulated expense' }).locator('xpath=ancestor::tr'))).toEqual(['partial', '5 USD', 'Amount unknown', '1']);
  expect(await cells(simulated.getByRole('rowheader', { name: 'Simulated gross sales' }).locator('xpath=ancestor::tr'))).toEqual(['unknown', 'Amount unknown', 'Amount unknown', '0']);
  const actual = page.getByRole('table', { name: 'USD parent totals' }).getByRole('rowheader', { name: 'expense' }).locator('xpath=ancestor::tr');
  expect(await cells(actual)).toEqual(['unknown', 'Amount unknown', 'Amount unknown', '0']);
  await expect(region(page, 'USD valuation and reconciliation')).toContainText('Unknown valuation count1');
  await scan(page, 'conformance-unknown-simulated-breakdown');
});

test('conformance-unknown-simulated budget reads limit and capacity as unknown with unresolved exposure', async ({ page }) => {
  await open(page, 'budgets', 'conformance-unknown-simulated');
  const card = region(page, 'USD budget advisory');
  await expect(card.getByRole('heading', { name: 'USD limit' }).locator('xpath=ancestor::section[1]')).toContainText('Amount unknown');
  await expect(card).toContainText('Yes: exposure is unresolved');
  await expect(card).toContainText('No policy reference delivered');
  await scan(page, 'conformance-unknown-simulated-budget');
});

test('conformance-budget shows the produced limit, held, remaining capacity and the independently pinned policy reference', async ({ page }) => {
  await open(page, 'budgets', 'conformance-budget');
  const card = region(page, 'USD budget advisory');
  const pair = (title: string) => card.getByRole('heading', { name: `USD ${title}` }).locator('xpath=ancestor::section[1]');
  await expect(pair('limit')).toContainText('1 USD');
  await expect(pair('held')).toContainText('0.75 USD');
  await expect(pair('remaining authorized capacity (advisory)')).toContainText('0.25 USD');
  await expect(pair('remaining authorized capacity (advisory)')).toContainText('Not spend authority');
  await expect(pair('ledger expense')).toContainText('0 USD');
  await expect(pair('lifecycle consumed')).toContainText('It is not ledger expense');
  await expect(card).toContainText('d8def504-7c33-4c2c-b33d-a428739d0dd4 revision 1 (sha256:122f70413f215f2cd0c897f6464d936a1b3c8f6038b642c88a9c714d64e1c583)');
  await scan(page, 'conformance-budget');
});

test('conformance-base keeps two currencies separate and shows 18-digit and negative strings verbatim', async ({ page }) => {
  await open(page, 'ai-costs', 'conformance-base');
  const usd = region(page, 'USD cost breakdown'); const eur = region(page, 'EUR cost breakdown');
  await expect(usd).not.toContainText('EUR');
  await expect(eur).not.toContainText('USD');
  await expect(eur).toContainText('-2 EUR');
  await expect(page.locator('main')).toContainText('1.000000000000000001 USD');
  await expect(page.getByRole('heading', { name: /combined|converted|grand total/iu })).toHaveCount(0);
  await scan(page, 'conformance-base-breakdown');
});

test('conformance-base transactions show the producer count and only the delivered page, and a detail opens by keyboard with intentional focus', async ({ page }) => {
  await open(page, 'transactions', 'conformance-base');
  await expect(region(page, 'Transaction list')).toContainText('Detail count (producer)6');
  // The connected view owns the read, so the list offers the next page of the same snapshot; the producer count (6) stays distinct from the rows on this page.
  await expect(region(page, 'Transaction list')).toContainText('Yes. Use Next page to request the next page of this same snapshot.');
  await expect(region(page, 'Transaction list')).toContainText('Rows on this page only');
  await expect(region(page, 'Transaction list')).toContainText('Held opaque for the next request; not shown or decoded');
  await expect(page.getByRole('table', { name: 'Transaction details' }).getByRole('rowheader')).toHaveCount(2);
  const link = page.getByRole('table', { name: 'Transaction details' }).getByRole('link', { name: /^sha256:/u }).first();
  await scan(page, 'conformance-base-transactions');
  await tabTo(page, link);
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(region(page, 'Transaction record')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await tabTo(page, page.getByRole('link', { name: 'Back to transactions' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table', { name: 'Transaction details' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test('conformance-pg shows the snapshot identity, the pending sign-off watermark and the policy reference', async ({ page }) => {
  await open(page, 'ai-costs', 'conformance-pg');
  const snapshot = region(page, 'Snapshot and scope');
  for (const text of ['sha256:9a0c1845f1bfd9b4da4c5639fba7a9972a123bca214729153cd175995c977715', 'sha256:e22bc18cd309a4c9f7e99b8086619cb35cfe2d7768a4fa531f63bdc147d066d0', 'sha256:f4f55d6902c9f0213b1407ac0a44135d490051ed5b28ceb4f7b845bf5120347d',
    'd7ed6030-1573-4b28-9da8-3a543d9b0689', 'PENDING FINANCE-OWNER SIGN-OFF', 'proposal_only_owner_ack_pending', 'ci08-reporting-policy-2.0.0', 'immutable_finance_inputs partial']) await expect(snapshot).toContainText(text);
  await scan(page, 'conformance-pg');
});

test('conformance-v1-refused: the v1 producer page is refused as an unsupported major and shows no amounts', async ({ page }) => {
  for (const path of ['budgets', 'ai-costs', 'transactions']) {
    await open(page, path, 'conformance-v1-refused');
    await expect(page.getByRole('alert').filter({ hasText: 'Report refused' })).toContainText('UNSUPPORTED_VERSION');
    await expect(page.getByRole('alert')).toContainText('/schemaVersion');
    await noAmounts(page);
  }
  await scan(page, 'conformance-v1-refused');
});

test('references are pinned by the host, not read from the payload: a policy reference rewritten inside the page is refused after hydration', async ({ page }) => {
  for (const path of ['budgets', 'ai-costs']) {
    await open(page, path, 'conformance-forged-policy');
    await expect(page.getByRole('alert').filter({ hasText: 'Report refused' })).toContainText('REFERENCE_MISMATCH');
    await expect(page.getByRole('alert')).toContainText('/canonicalSummaries/0/policy_ref');
    await noAmounts(page);
  }
  await scan(page, 'conformance-forged-policy');
});

test('the host registry the references come from is the independently pinned file, and every committed artifact still matches its pin', async () => {
  const dir = 'tests/fixtures/finance-v2-conformance';
  const provenance = JSON.parse(readFileSync(`${dir}/PROVENANCE.json`, 'utf8')) as { producer: { tree: string }; committed: { path: string; sha256: string }[] };
  expect(provenance.producer.tree).toBe('4f8dcc44019ec0f73ab3aa7c0eb1d5de40bb777e');
  expect(provenance.committed).toHaveLength(9);
  for (const { path, sha256 } of provenance.committed) expect(createHash('sha256').update(readFileSync(`${dir}/${path}`)).digest('hex'), path).toBe(sha256);
  expect(provenance.committed.find((item) => item.path === 'definition-registry.json')?.sha256).toBe('577ce8801855db08ba393f115c00ac670df3a47a5cc9e9a5a78f8b0132cb34e1');
});

test('the CFO export stays disabled on every conformance route and nothing downloads', async ({ page }) => {
  for (const [path, fixture] of [['budgets', 'conformance-budget'], ['ai-costs', 'conformance-base'], ['transactions', 'conformance-base']] as const) {
    await open(page, path, fixture);
    await expect(region(page, 'CFO export').getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
    await expect(page.locator('a[download]')).toHaveCount(0);
  }
  await expect(page.locator('main')).not.toContainText(/export (started|complete|succeeded)|downloaded/iu);
});

for (const [path, fixture] of [['ai-costs', 'conformance-unknown-simulated'], ['ai-costs', 'conformance-base'], ['transactions', 'conformance-base'], ['budgets', 'conformance-budget']] as const) {
  test(`${path} / ${fixture} reflows at 320 CSS pixels, and any overflowing table is scrollable by keyboard`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, path, fixture);
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    const rights = page.getByRole('button', { name: /^Scroll .* right$/u });
    for (let index = 0; index < await rights.count(); index += 1) {
      const right = rights.nth(index);
      const name = (await right.getAttribute('aria-label')) ?? (await right.innerText());
      const viewport = region(page, name.replace(/^Scroll /u, '').replace(/ right$/u, ''));
      await tabTo(page, right);
      await expect(right).toBeFocused();
      await page.keyboard.press('End');
      await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await page.keyboard.press('Home');
      await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(0);
      await expect(right).toBeFocused();
    }
    await scan(page, `conformance-${path}-${fixture}-320`);
  });
}

test('a settled conformance answer is withdrawn when the host revokes the token or availability, and a regrant reads again', async ({ page }) => {
  await open(page, 'ai-costs', 'conformance-unknown-simulated');
  await expect(region(page, 'USD simulated')).toBeVisible();
  await page.getByLabel('Finance v2 host token').uncheck();
  await expect(page.getByRole('alert')).toContainText('not authorized');
  await noAmounts(page);
  await page.getByLabel('Finance v2 host token').check();
  await expect(region(page, 'USD simulated')).toBeVisible();
  await page.getByLabel('Finance v2 host available').uncheck();
  await expect(page.getByRole('status').filter({ hasText: 'restricted for your access' })).toBeVisible();
  await noAmounts(page);
  await page.getByLabel('Finance v2 host available').check();
  await expect(region(page, 'USD simulated')).toBeVisible();
  expect((await portCalls(page)).length).toBe(3);
});

test('a token revoked while a conformance read is in flight cancels it, and the ignored-abort late answer never reaches the DOM', async ({ page }) => {
  await open(page, 'ai-costs', 'conformance-unknown-simulated', '&v2port=slow');
  await expect(page.getByRole('status').filter({ hasText: 'Loading the report' })).toBeVisible();
  await noAmounts(page);
  await page.getByLabel('Finance v2 host token').uncheck();
  await expect(page.getByRole('alert')).toContainText('not authorized');
  // The abandoned slow read answers after 1.5 s although it ignores the abort signal; it must stay out.
  await page.waitForTimeout(2000);
  await noAmounts(page);
  await expect(region(page, 'USD simulated')).toHaveCount(0);
  await page.getByLabel('Finance v2 host token').check();
  await expect(region(page, 'USD simulated')).toBeVisible({ timeout: 6000 });
});

test('an actor change on a conformance route discards the earlier answer and reads again for the new actor', async ({ page }) => {
  await open(page, 'ai-costs', 'conformance-unknown-simulated', '&v2port=slow');
  await expect(region(page, 'USD simulated')).toBeVisible({ timeout: 6000 });
  await page.getByLabel('Finance v2 actor').selectOption('b');
  await expect(page.getByRole('status').filter({ hasText: 'Loading the report' })).toBeVisible();
  await noAmounts(page);
  // The produced page is bound to the original actor, so the answer for actor b is refused rather than shown under the wrong identity.
  await expect(page.getByRole('alert').filter({ hasText: 'Report refused' })).toContainText('SCOPE_MISMATCH', { timeout: 6000 });
  await noAmounts(page);
  expect((await portCalls(page)).length).toBe(2);
});
