import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expectPrivate } from './private-context';

/**
 * SYNTHETIC_EXPORT_CONFORMANCE_ONLY. Real Chromium + axe over the real, hydrated client. The fixture host injects an export port that REPLAYS the Finance producer's ACTUAL candidate
 * receipt 0 (exact manifest and artifact bytes, pinned to the handoff digests below) or a labelled test-built deviation of it, and a host-owned access store the Dashboard reads
 * synchronously. None of it is a mounted host, a live Product issuer, a coherent live fence, CFO delivery, or a consumer acceptance. This file is authored for hosted Linux; it has not
 * been executed in the author's sandbox.
 */
test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') { await route.continue(); return; }
    if (url.hostname !== '127.0.0.1') { await route.abort(); throw new Error('Unexpected external request in synthetic export conformance harness.'); }
    await route.continue();
  });
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (message) => { if (message.type() === 'error') throw new Error(message.text()); });
});

const SUMMARY_SHA = '9129ef4a88437e70d7c7da85c8ad36d5ce3c9569a66aa779a4e694ee1f1a1353';
const SUMMARY_BYTES = 14013;
const CANARY = 'CANARY-PORT-MESSAGE-must-never-be-shown';
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const open = (page: Page, query = '', path = 'budgets') => page.goto(`/admin/finance/${path}?state=ready&v2=export-conformance${query ? `&${query}` : ''}`);
const exportRegion = (page: Page) => page.getByRole('region', { name: 'CFO export' });
const prepareButton = (page: Page) => page.getByRole('button', { name: 'Prepare manual export' });
const downloadButton = (page: Page) => page.getByRole('button', { name: 'Download summary.json' });
const requests = (page: Page) => page.evaluate(() => (window as unknown as { __financeV2ExportLog: { requests: { format: string; actorId: string; revision: string; token: string; snapshotId: string; destination: string }[] } }).__financeV2ExportLog.requests);
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
const noDownload = async (page: Page) => { await expect(page.waitForEvent('download', { timeout: 750 })).rejects.toThrow(); };
async function leaks(page: Page) {
  await expectPrivate(page, ['fixture-token', CANARY, 'finance_reporting_export_proposal', 'currency,scale,metric', 'Parallel simulated']);
}

test('keyboard-only: prepare the actual producer JSON, see the honest manual status, and download the exact bytes', async ({ page }) => {
  await open(page);
  const region = exportRegion(page);
  await expect(region.getByRole('heading', { name: 'CFO export' })).toBeVisible();
  await expect(region.getByRole('note')).toContainText('SYNTHETIC_EXPORT_CONFORMANCE_ONLY');
  await expect(region.getByRole('radio', { name: 'JSON (summary.json)' })).toBeChecked();
  await expect(downloadButton(page)).toHaveCount(0);
  await scan(page, 'export-idle');
  await tabTo(page, prepareButton(page));
  await page.keyboard.press('Enter');
  await expect(region).toContainText('Prepared for manual handoff. It has not been delivered to the CFO and there is no delivery reference.');
  // Focus stays on the control that was activated: nothing unmounts under the keyboard.
  expect(await prepareButton(page).evaluate((element) => element === document.activeElement)).toBe(true);
  await expect(region).toContainText('manual_prepared (not delivered)');
  await expect(region).toContainText('Delivery referenceNone');
  await expect(region).toContainText('sha256:3d33f92e69e26c63c6047a48c4e1dd7cb49f93798d180c0a35dbc13a636eccf1');
  await expect(region).toContainText('2026-10-12T22:00:00.000Z');
  await expect(region).toContainText(`summary.json${SUMMARY_BYTES} bytes, sha256:${SUMMARY_SHA}`);
  await expect(region).not.toContainText(/delivered to (the )?CFO(?! )|successfully (sent|exported)/iu);
  await scan(page, 'export-prepared');
  const sent = await requests(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ format: 'json', destination: 'cfo.ai', actorId: 'account:synthetic-actor', revision: '1', snapshotId: 'sha256:80448f1b4ce01f3df2e72e0b374c37365d873828e837bf89cea17ac0c6c999e6' });
  await leaks(page);
  await tabTo(page, downloadButton(page));
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(download.suggestedFilename()).toBe('summary.json');
  const bytes = readFileSync((await download.path())!);
  expect(bytes.length).toBe(SUMMARY_BYTES);
  expect(sha256(bytes)).toBe(SUMMARY_SHA);
  expect(bytes.toString('utf8').endsWith('\n')).toBe(true);
  expect(bytes.toString('utf8')).toContain('"unavailableMetrics":[{"knownSubtotal":null,"metric":"cash_net","status":"not_supplied_by_query","total":null}]');
  await expect(region).toContainText('Download of summary.json started.');
  await leaks(page);
  expect(page.url()).not.toContain('blob:');
});

test('the CSV request: the radio group is arrow-key operable, and the producer\'s JSON-prepared receipt is refused for the CSV format with no download', async ({ page }) => {
  await open(page);
  const region = exportRegion(page);
  await tabTo(page, region.getByRole('radio', { name: 'JSON (summary.json)' }));
  await page.keyboard.press('ArrowDown');
  await expect(region.getByRole('radio', { name: 'CSV (metrics.csv)' })).toBeChecked();
  await tabTo(page, prepareButton(page));
  await page.keyboard.press('Space');
  await expect(region.getByRole('alert')).toContainText('Export refused');
  await expect(region.getByRole('alert')).toContainText('FORMAT_MISMATCH');
  await expect(region.getByRole('button', { name: /^Download / })).toHaveCount(0);
  expect((await requests(page)).map((entry) => entry.format)).toEqual(['csv']);
  await scan(page, 'export-refused-format');
  await noDownload(page);
});

test('TEST_BUILT CSV control: keyboard select, prepare and download of the original metrics.csv bytes, honestly labelled manual_prepared and not a producer CSV request', async ({ page }) => {
  const original = (JSON.parse(readFileSync('tests/fixtures/export-conformance/candidate-receipts/receipt-00.json', 'utf8')) as { receipt: { artifacts: { fileName: string; content: string; contentHash: string; byteLength: number }[] } }).receipt.artifacts.find((artifact) => artifact.fileName === 'metrics.csv')!;
  await open(page, 'v2export=csv-control');
  const region = exportRegion(page);
  await expect(page.getByRole('note').filter({ hasText: 'TEST_BUILT CSV control' })).toContainText('not a producer-prepared CSV request');
  await tabTo(page, region.getByRole('radio', { name: 'JSON (summary.json)' }));
  await page.keyboard.press('ArrowDown');
  await expect(region.getByRole('radio', { name: 'CSV (metrics.csv)' })).toBeChecked();
  await tabTo(page, prepareButton(page));
  await page.keyboard.press('Enter');
  const csvButton = region.getByRole('button', { name: 'Download metrics.csv' });
  await expect(csvButton).toBeVisible();
  await expect(region).toContainText('manual_prepared (not delivered)');
  await expect(region).toContainText('Delivery referenceNone');
  await expect(region).toContainText('Requested formatcsv');
  await expect(region).toContainText(`metrics.csv${original.byteLength} bytes, ${original.contentHash}`);
  await expect(region).not.toContainText(/delivered to (the )?CFO(?! )|successfully (sent|exported)/iu);
  expect((await requests(page)).map((entry) => entry.format)).toEqual(['csv']);
  await scan(page, 'export-csv-control-prepared');
  await leaks(page);
  await tabTo(page, csvButton);
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(download.suggestedFilename()).toBe('metrics.csv');
  const bytes = readFileSync((await download.path())!);
  expect(bytes.length).toBe(original.byteLength);
  expect(Buffer.from(original.content, 'utf8').equals(bytes)).toBe(true);
  expect(`sha256:${sha256(bytes)}`).toBe(original.contentHash);
  await expect(region).toContainText('Download of metrics.csv started.');
  await leaks(page);
  expect(page.url()).not.toContain('blob:');
});

test('export permission is separate from read permission and both are honoured; nothing is requested without them', async ({ page }) => {
  await open(page);
  const region = exportRegion(page);
  await page.getByLabel('Dashboard export capability').uncheck();
  await expect(region.getByRole('status')).toContainText('You do not have export permission');
  await expect(region.getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
  await expect(prepareButton(page)).toHaveCount(0);
  await scan(page, 'export-no-export-permission');
  await page.getByLabel('Dashboard export capability').check();
  await expect(prepareButton(page)).toBeVisible();
  await page.getByLabel('Dashboard read capability').uncheck();
  await expect(region.getByRole('status')).toContainText('Export needs read access');
  await expect(prepareButton(page)).toHaveCount(0);
  expect(await requests(page)).toEqual([]);
});

test('fail-closed: no port, no host access reader, and INTEGRATED mode each leave export unavailable with no request', async ({ page }) => {
  await open(page, 'v2export=none');
  await expect(exportRegion(page).getByRole('status')).toContainText('No export port was provided by the host');
  await expect(prepareButton(page)).toHaveCount(0);
  await open(page, 'v2access=none');
  await expect(exportRegion(page).getByRole('status')).toContainText('The host has not stated current export access');
  await expect(prepareButton(page)).toHaveCount(0);
  await open(page, 'v2mode=integrated');
  await expect(page.getByRole('main')).toContainText('no accepted read port exists');
  await expect(prepareButton(page)).toHaveCount(0);
  expect(await requests(page)).toEqual([]);
  await scan(page, 'export-integrated');
});

test('a host revocation with no re-render discloses nothing: the click is vetoed and the bytes are dropped', async ({ page }) => {
  await open(page);
  const region = exportRegion(page);
  await prepareButton(page).click();
  await expect(downloadButton(page)).toBeVisible();
  await page.getByRole('button', { name: 'Revoke export capability silently' }).click();
  await downloadButton(page).click({ noWaitAfter: true });
  await expect(region.getByRole('status')).toContainText('You do not have export permission');
  await expect(region.getByRole('button', { name: /^Download / })).toHaveCount(0);
  await noDownload(page);
  await page.getByLabel('Dashboard export capability').uncheck();
  await page.getByLabel('Dashboard export capability').check();
  await expect(downloadButton(page)).toHaveCount(0);
});

test('host expiry with no re-render is noticed on its own while a prepared export is on screen', async ({ page }) => {
  await open(page);
  await prepareButton(page).click();
  await expect(downloadButton(page)).toBeVisible();
  await page.getByRole('button', { name: 'Expire host access silently' }).click();
  await expect(exportRegion(page).getByRole('status')).toContainText('Your access has expired', { timeout: 3000 });
  await expect(downloadButton(page)).toHaveCount(0);
  await noDownload(page);
});

test('a revocation that lands while the port is answering drops that valid answer', async ({ page }) => {
  await open(page, 'v2export=revoke-during');
  await prepareButton(page).click();
  await expect(exportRegion(page).getByRole('status')).toContainText('You do not have export permission');
  await expect(downloadButton(page)).toHaveCount(0);
  await expect(exportRegion(page)).not.toContainText('Prepared for manual handoff');
  await noDownload(page);
});

test.describe('late answers from a port that ignores the abort signal are dropped', () => {
  test('after an authorization revision change', async ({ page }) => {
    await open(page, 'v2export=slow');
    await prepareButton(page).click();
    await expect(exportRegion(page).getByRole('status')).toContainText('Preparing the export');
    await scan(page, 'export-preparing');
    await page.getByRole('button', { name: /Bump Finance v2 authorization revision/u }).click();
    await page.waitForTimeout(2200);
    await expect(exportRegion(page)).not.toContainText('Prepared for manual handoff');
    await expect(downloadButton(page)).toHaveCount(0);
    await expect(prepareButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    expect(await requests(page)).toHaveLength(1);
  });
  test('after an actor change', async ({ page }) => {
    await open(page, 'v2export=slow');
    await prepareButton(page).click();
    await page.getByLabel('Finance v2 actor').selectOption('b');
    await page.waitForTimeout(2200);
    await expect(exportRegion(page)).not.toContainText('Prepared for manual handoff');
    await expect(downloadButton(page)).toHaveCount(0);
    const sent = await requests(page);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actorId).toBe('account:synthetic-actor');
  });
  test('after a format change', async ({ page }) => {
    await open(page, 'v2export=slow');
    await prepareButton(page).click();
    await exportRegion(page).getByRole('radio', { name: 'CSV (metrics.csv)' }).check();
    await page.waitForTimeout(2200);
    await expect(exportRegion(page)).not.toContainText('Prepared for manual handoff');
    await expect(exportRegion(page).getByRole('button', { name: /^Download / })).toHaveCount(0);
  });
  test('after a transaction filter change', async ({ page }) => {
    await open(page, 'v2export=slow', 'transactions');
    await prepareButton(page).click();
    await page.getByLabel('Valuation').selectOption('estimated');
    await page.waitForTimeout(2200);
    await expect(exportRegion(page)).not.toContainText('Prepared for manual handoff');
    await expect(downloadButton(page)).toHaveCount(0);
  });
});

test.describe('typed producer failures show fixed copy only, and tampered answers are refused with no download', () => {
  const failures: readonly (readonly [string, string])[] = [
    ['source', 'The export source is unavailable right now. No file was produced.'],
    ['forbidden', 'Export is not permitted for this scope or access. No file was produced.'],
    ['conflict', 'This snapshot was already prepared with different parameters. No file was produced.'],
    ['validation', 'The export request was not valid. No file was produced.'],
    ['unsupported', 'This snapshot cannot be exported in a supported format. No file was produced.'],
    ['fault500', 'The export could not be prepared. No file was produced.'],
  ];
  for (const [behavior, copy] of failures) {
    test(`${behavior}`, async ({ page }) => {
      await open(page, `v2export=${behavior}`);
      await prepareButton(page).click();
      await expect(exportRegion(page).getByRole('alert')).toContainText(copy);
      await expect(exportRegion(page).getByRole('button', { name: /^Download / })).toHaveCount(0);
      await leaks(page);
      await scan(page, `export-failure-${behavior}`);
    });
  }
  const tampered: readonly (readonly [string, string, string])[] = [
    ['tamper-snapshot', 'SNAPSHOT_MISMATCH', '/value/manifest/snapshotId'],
    ['tamper-query', 'QUERY_HASH_MISMATCH', '/value/manifest/queryContentHash'],
    ['tamper-csv-scope', 'SCOPE_MISMATCH', '/artifacts/1/content/rows/0'],
    ['delivered', 'UNSUPPORTED_STATUS', '/value/manifest/status'],
    ['legacy', 'UNSUPPORTED_SHAPE', '/value'],
    ['extra', 'INVALID_SHAPE', '/value/manifest'],
  ];
  for (const [behavior, code, path] of tampered) {
    test(`${behavior} is refused as ${code}`, async ({ page }) => {
      await open(page, `v2export=${behavior}`);
      await prepareButton(page).click();
      const alert = exportRegion(page).getByRole('alert');
      await expect(alert).toContainText('Export refused');
      await expect(alert).toContainText(code);
      await expect(alert).toContainText(path);
      await expect(exportRegion(page)).not.toContainText('Prepared for manual handoff');
      await expect(exportRegion(page).getByRole('button', { name: /^Download / })).toHaveCount(0);
      await noDownload(page);
      await leaks(page);
      await scan(page, `export-refused-${behavior}`);
    });
  }
});

test('a hanging port times out into fixed copy and allows a retry', async ({ page }) => {
  await open(page, 'v2export=hang&v2timeout=600');
  await prepareButton(page).click();
  await expect(exportRegion(page).getByRole('alert')).toContainText('The export could not be prepared', { timeout: 5000 });
  await expect(prepareButton(page)).toBeVisible();
});

test('320 CSS pixels: no page-level horizontal scroll, controls inside the viewport at a usable size, axe clean, and the keyboard path still works', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  const region = exportRegion(page);
  await region.scrollIntoViewIfNeeded();
  await expect(prepareButton(page)).toBeVisible();
  await tabTo(page, prepareButton(page));
  await page.keyboard.press('Enter');
  await expect(downloadButton(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  for (const control of [prepareButton(page), downloadButton(page), region.getByRole('radio', { name: 'JSON (summary.json)' })]) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.height).toBeGreaterThanOrEqual(24);
  }
  for (const button of [prepareButton(page), downloadButton(page)]) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await scan(page, 'export-prepared-320');
});

/**
 * SYNTHETIC_DENIAL_CAPTURE_SUPPLEMENT_ONLY. The fixture host replays the EXACT `actualResult` of two ACTUAL captured producer cases (task-local PostgreSQL with synthetic postings behind a
 * synthetic single-state authority host; not a live issuer, not fresh database execution, not a live Finance integration). The page's own access is ALLOWED (read and export are both
 * stated by the host), so the denial below is the producer's answer. The positive JSON and TEST_BUILT CSV download journeys above are unchanged. Authored for hosted Linux; not executed in the author's sandbox.
 */
test.describe('captured producer denials: current UI access allowed, producer denies', () => {
  const captured: readonly (readonly [string, string, string, string, string])[] = [
    ['captured-late-forbidden', 'FORBIDDEN_SCOPE', 'Export is not permitted for this scope or access. No file was produced.', 'Current financial disclosure is not authorized.', 'ci1:af813163-9fbc-448f-aebd-1ea541c3ee5f'],
    ['captured-entry-source', 'SOURCE_UNAVAILABLE', 'The export source is unavailable right now. No file was produced.', 'A coherent current financial disclosure capability is unavailable.', 'ci1:abc3f0e8-5fcf-47bd-975a-3e5d416dd853'],
  ];
  for (const [behavior, code, copy, message, diagnostic] of captured) {
    test(`${behavior} (${code}): keyboard prepare shows the generic copy, no download, no artifact, message, diagnostic, token or cursor anywhere`, async ({ page }) => {
      await open(page, `v2export=${behavior}`);
      const region = exportRegion(page);
      await expect(region.getByRole('note')).toContainText('SYNTHETIC_EXPORT_CONFORMANCE_ONLY');
      // The UI itself would allow this export: the prepare control is live and no unavailable reason is shown.
      await expect(prepareButton(page)).toBeVisible();
      await expect(region).not.toContainText('Export unavailable');
      await tabTo(page, prepareButton(page));
      await page.keyboard.press('Enter');
      await expect(region.getByRole('alert')).toContainText(copy);
      expect(await prepareButton(page).evaluate((element) => element === document.activeElement)).toBe(true);
      await expect(region.getByRole('button', { name: /^Download / })).toHaveCount(0);
      await expect(region).not.toContainText(/Prepared for manual handoff|Export id|sha256:/u);
      await noDownload(page);
      const sent = await requests(page);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ format: 'json', destination: 'cfo.ai', revision: '1' });
      await expectPrivate(page, [message, diagnostic, 'ci1:', 'fixture-token', 'finance_reporting_export_proposal', 'currency,scale,metric']);
      await leaks(page);
      await scan(page, `export-captured-${behavior}`);
    });
  }
  test('320 CSS pixels: the captured denial keeps the keyboard path, a non-scrolling page, axe clean, and controls of at least 24 CSS pixels', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, 'v2export=captured-late-forbidden');
    const region = exportRegion(page);
    await region.scrollIntoViewIfNeeded();
    await tabTo(page, prepareButton(page));
    await page.keyboard.press('Enter');
    await expect(region.getByRole('alert')).toContainText('Export is not permitted for this scope or access. No file was produced.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    for (const control of [prepareButton(page), region.getByRole('radio', { name: 'JSON (summary.json)' }), region.getByRole('radio', { name: 'CSV (metrics.csv)' })]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
    await expect(region.getByRole('button', { name: /^Download / })).toHaveCount(0);
    await scan(page, 'export-captured-denial-320');
  });
});
