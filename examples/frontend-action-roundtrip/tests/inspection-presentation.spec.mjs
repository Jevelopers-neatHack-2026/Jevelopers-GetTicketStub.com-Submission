import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('presentation-only inspection scenarios retain stable references, unknown costs and keyboard/focus semantics without requests', async ({ page, request }, testInfo) => {
  await request.post('/__fixture/reset', { data: {} });
  const before = await (await request.get('/api/counters')).json(), posts = [], errors = [], exceptions = [];
  page.on('request', req => { if (req.method() === 'POST') posts.push(req.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/inspection-presentation.html');
  await expect(page.getByLabel('Presentation scenario')).toHaveValue('pending');
  await expect(page.getByRole('status')).toContainText('Inspection pending');
  await expect(page.getByRole('button', { name: 'Inspect saved artwork' })).toBeDisabled();
  const session = await page.context().newCDPSession(page); await session.send('Debugger.enable'); await session.send('Debugger.setPauseOnExceptions', { state: 'all' });
  session.on('Debugger.paused', async value => { if (value.reason === 'exception' || value.reason === 'promiseRejection') exceptions.push(value.data?.description ?? value.reason); await session.send('Debugger.resume'); });
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Presentation scenario')).toBeFocused();
  await page.keyboard.press('r');
  await expect(page.getByRole('status')).toContainText('Ready for human review'); await expect(page.getByRole('status')).toBeFocused();
  const refs = await page.locator('#inspection-refs').innerText();
  const seen = [];
  for (const [scenario, message, unknown] of [
    ['recommended', 'Repair recommended', true], ['human', 'Human review required', true], ['refused', 'Inspection refused', true],
    ['failure', 'Inspection found a failure', true], ['unavailable', 'Inspection unavailable', true], ['failed', 'Inspection did not complete', true],
    ['pending', 'Inspection pending', true], ['acceptable', 'Ready for human review', false],
  ]) {
    await page.getByLabel('Presentation scenario').selectOption(scenario);
    const status = page.getByRole(['unavailable', 'failed'].includes(scenario) ? 'alert' : 'status');
    await expect(status).toContainText(message); await expect(status).toBeFocused();
    await expect(page.locator('#inspection-refs')).toHaveText(refs, { useInnerText: true });
    if (unknown) await expect(page.locator('#inspection-usage')).toContainText('unknown');
    await expect(page.locator('#inspection-authority')).toContainText('cannot start repair, approve artwork or authorize purchase');
    seen.push({ scenario, message: await status.innerText(), usage: await page.locator('#inspection-usage').innerText(), hold: await page.locator('#inspection-hold').innerText() });
  }
  await page.getByLabel('Presentation scenario').selectOption('failed');
  await expect(page.getByRole('alert')).toContainText('saved artwork remains available');
  await expect(page.locator('#inspection-hold')).toContainText('Reservation remains held');
  await expect(page.locator('#inspection-retry')).toContainText('Do not regenerate the saved edit');
  expect(exceptions).toEqual([]); expect(errors).toEqual([]); await session.detach();
  expect(posts).toEqual([]); expect(await (await request.get('/api/counters')).json()).toEqual(before);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/inspection-presentation-only-failure.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/inspection-presentation-only-mobile.png', fullPage: true });
  await testInfo.attach('inspection-presentation-only', { body: JSON.stringify({ evidence_mode: 'local-input-fixture', actual_ce09_integration: false,
    seen, references: refs, posts, before, exceptions, page_errors: errors, live_application_calls: 0 }), contentType: 'application/json' });
});

test('malformed presentation-only input stays private with fixed focused error and zero authority', async ({ page, request }) => {
  await request.post('/__fixture/reset', { data: {} }); const before = await (await request.get('/api/counters')).json();
  const posts = []; page.on('request', req => { if (req.method() === 'POST') posts.push(req.url()); });
  await page.route('**/inspection-inputs.json', async route => {
    const value = await (await route.fetch()).json();
    value.cases.failed.input.references.inspection_action_id = 'design.ghp_' + 'a'.repeat(36);
    value.cases.failed.input.report = { recommendation: 'Bearer synthetic-private-prompt' };
    await route.fulfill({ json: value });
  });
  await page.goto('/inspection-presentation.html'); await expect(page.getByLabel('Presentation scenario')).toHaveValue('pending');
  await page.getByLabel('Presentation scenario').selectOption('failed');
  await expect(page.getByRole('alert')).toHaveText('Inspection presentation unavailable. Saved artwork status is unchanged.');
  await expect(page.getByRole('alert')).toBeFocused(); await expect(page.locator('#inspection-refs')).toBeEmpty();
  expect(await page.locator('body').innerText()).not.toMatch(/ghp_|Bearer|synthetic-private-prompt/);
  expect(posts).toEqual([]); expect(await (await request.get('/api/counters')).json()).toEqual(before);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
