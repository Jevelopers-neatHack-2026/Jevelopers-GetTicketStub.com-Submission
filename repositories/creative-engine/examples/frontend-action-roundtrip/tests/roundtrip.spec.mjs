import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page, request }) => {
  await request.post('/__fixture/reset', { data: {} });
  await page.goto('/');
  await expect(page.getByLabel('Name size', { exact: true })).toBeVisible();
});
const counters = async request => (await request.get('/api/counters')).json();

test('keyboard draft, labelled locked control, follow-up and explicit Apply roundtrip are accessible', async ({ page, request }) => {
  const posts = []; page.on('request', req => { if (req.method() === 'POST') posts.push(req.url()); });
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Name size', { exact: true })).toBeFocused();
  // Native select type-ahead works on macOS and Linux headless Chromium.
  await page.keyboard.press('l');
  await expect(page.getByLabel('Name size', { exact: true })).toHaveValue('large');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Layout', { exact: true })).toBeFocused();
  await page.keyboard.press('s');
  await expect(page.getByLabel('Stacked layout emphasis')).toBeVisible();
  await expect(page.getByLabel('Approved logo position')).toBeDisabled();
  await expect(page.getByLabel('Approved logo position')).toHaveAttribute('aria-describedby', 'lock-c03');
  await expect(page.getByLabel('Stacked layout emphasis')).toHaveAttribute('required', '');
  expect(posts).toEqual([]);
  expect(await counters(request)).toMatchObject({ jobs: 0, jev_calls: 0, image_calls: 0, mode: 'mock' });
  const before = await new AxeBuilder({ page }).analyze(); expect(before.violations).toEqual([]);
  // Tab through editable controls; the locked select is skipped by the browser.
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Artwork style')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Stacked layout emphasis')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toContainText('Apply accepted');
  await page.getByRole('button', { name: 'Validate handoff' }).click();
  await expect(page.locator('#status')).toContainText('Typed handoff ready');
  expect(await counters(request)).toMatchObject({ jobs: 1, jev_calls: 0, image_calls: 0 });
  const after = await new AxeBuilder({ page }).analyze(); expect(after.violations).toEqual([]);
  await page.screenshot({ path: 'test-results/mock-roundtrip.png', fullPage: true });
});

test('lost response, Retry and simultaneous duplicates retain one durable operation identity', async ({ page, request }) => {
  let sent;
  await page.route('**/api/apply', async route => { sent = route.request().postDataJSON(); await route.fetch(); await route.abort('failed'); });
  await page.getByLabel('Name size', { exact: true }).selectOption('large');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Retry last Apply');
  expect(await counters(request)).toMatchObject({ jobs: 1, jev_calls: 0, image_calls: 0 });
  await page.unroute('**/api/apply');
  await page.getByRole('button', { name: 'Retry last Apply' }).click();
  await expect(page.locator('#status')).toContainText('Existing operation returned');
  const results = await Promise.all([request.post('/api/apply', { data: sent }), request.post('/api/apply', { data: sent })]);
  const bodies = await Promise.all(results.map(r => r.json()));
  expect(bodies.every(r => r.code === 'replayed')).toBe(true);
  expect(new Set(bodies.map(r => r.operation_id)).size).toBe(1);
  expect(await counters(request)).toMatchObject({ jobs: 1, jev_calls: 0, image_calls: 0 });
});

test('stale controls reject Apply with focused accessible error; Refresh requires fresh review', async ({ page, request }) => {
  await page.getByLabel('Name size', { exact: true }).selectOption('large');
  await request.post('/__fixture/state', { data: { advance_design: true } });
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('stale'); await expect(page.getByRole('alert')).toBeFocused();
  expect(await counters(request)).toMatchObject({ jobs: 0, jev_calls: 0, image_calls: 0 });
  await page.getByRole('button', { name: 'Refresh controls' }).click();
  await expect(page.getByLabel('Name size', { exact: true })).toHaveValue('medium');
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeDisabled();
  await expect(page.locator('#versions')).toContainText('design_v2');
  await page.getByLabel('Name size', { exact: true }).selectOption('large');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Apply accepted');
});

for (const [name, mutate, message] of [
  ['cross-tenant action', a => { a.tenant_id = 'forged_tenant'; }, 'Permission denied'],
  ['cross-project action', a => { a.project_id = 'forged_project'; }, 'Permission denied'],
  ['invalid action', a => { a.html = '<script>window.attack=true</script>'; }, 'Unsupported action fields'],
  ['privileged action', a => { a.intent = 'purchase'; }, 'Unsupported action. Only explicit Apply'],
  ['unsupported schema', a => { a.schema_version = 'creative-controls/2.0'; }, 'Unsupported controls version'],
]) test(`${name} is rejected over actual browser Apply path without a job`, async ({ page, request }) => {
  await page.route('**/api/apply', async route => { const body = route.request().postDataJSON(); mutate(body); await route.continue({ postData: JSON.stringify(body) }); });
  await page.getByLabel('Name size', { exact: true }).selectOption('large');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(message);
  expect(await counters(request)).toMatchObject({ jobs: 0, jev_calls: 0, image_calls: 0 });
  expect(await page.evaluate(() => window.attack)).toBeUndefined();
});

test('permission revoked between Apply and handoff prevents dispatch; cancellation blocks late retry', async ({ page, request }) => {
  await page.getByLabel('Name size', { exact: true }).selectOption('large');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Apply accepted');
  await request.post('/__fixture/state', { data: { revoke: true } });
  await page.getByRole('button', { name: 'Validate handoff' }).click();
  await expect(page.getByRole('alert')).toContainText('Permission denied');
  await page.getByRole('button', { name: 'Cancel operation' }).click();
  await expect(page.locator('#status')).toContainText('Operation cancelled');
  // Cancelling does not grant an approval, and retry under revoked authority still fails.
  await page.getByRole('button', { name: 'Retry last Apply' }).click();
  await expect(page.getByRole('alert')).toContainText('Permission denied');
  expect(await counters(request)).toMatchObject({ jobs: 1, jev_calls: 0, image_calls: 0 });
});

test('artwork choice is a typed pending operation; paid handoff unavailable', async ({ page, request }) => {
  await page.getByLabel('Artwork style').selectOption('vibrant');
  expect(await counters(request)).toMatchObject({ jobs: 0, jev_calls: 0, image_calls: 0 });
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Apply accepted');
  await page.getByRole('button', { name: 'Validate handoff' }).click();
  await expect(page.getByRole('alert')).toContainText('Apply outcome unavailable');
  expect(await counters(request)).toMatchObject({ jobs: 1, jev_calls: 0, image_calls: 0 });
});

test('browser consumer rejects executable schema before rendering it', async ({ page }) => {
  await page.route('**/api/schema', async route => {
    const response = await route.fetch(); const data = await response.json(); data.schema.controls[0].kind = 'script';
    await route.fulfill({ response, json: data });
  });
  await page.getByRole('button', { name: 'Refresh controls' }).click();
  await expect(page.getByRole('alert')).toContainText('Controls unavailable');
  expect(await page.evaluate(() => window.attack)).toBeUndefined();
});

test('stored stacked emphasis survives refresh and a later name-size edit', async ({ page, request }) => {
  await request.post('/__fixture/state', { data: { stacked_name: true } });
  await page.getByRole('button', { name: 'Refresh controls' }).click();
  await expect(page.getByLabel('Stacked layout emphasis')).toHaveValue('name');
  await page.getByLabel('Name size', { exact: true }).selectOption('large');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Apply accepted');
  const response = page.waitForResponse('**/api/dispatch');
  await page.getByRole('button', { name: 'Validate handoff' }).click();
  const handoff = await (await response).json();
  expect(handoff.operation.tasks[0].changes).toEqual([{ field: 'name_size', value: 'large' }]);
  expect(handoff.operation.tasks[0].follow_up_answers).toEqual({ q01: 'name' });
  expect(await counters(request)).toMatchObject({ jobs: 1, jev_calls: 0, image_calls: 0 });
});

test('follow-up-only browser edit is an explicit composition change and honors locks', async ({ page, request }) => {
  await request.post('/__fixture/state', { data: { stacked_name: true, lock_followup: true } });
  await page.getByRole('button', { name: 'Refresh controls' }).click();
  await expect(page.getByLabel('Stacked layout emphasis')).toBeDisabled();
  await request.post('/__fixture/reset', { data: {} });
  await request.post('/__fixture/state', { data: { stacked_name: true } });
  await page.getByRole('button', { name: 'Refresh controls' }).click();
  await page.getByLabel('Stacked layout emphasis').selectOption('balanced');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Apply accepted');
  const response = page.waitForResponse('**/api/dispatch');
  await page.getByRole('button', { name: 'Validate handoff' }).click();
  const handoff = await (await response).json();
  expect(handoff.operation.tasks[0].changes).toEqual([{ field: 'layout_emphasis', value: 'balanced' }]);
  expect(handoff.operation.tasks[0].follow_up_answers).toEqual({ q01: 'balanced' });
  expect(await counters(request)).toMatchObject({ jobs: 1, jev_calls: 0, image_calls: 0 });
});


test('genuine ready Apply replay acknowledges the same operation without fresh handoff or saved-artwork claims', async ({ page, request }, testInfo) => {
  const errors = [], posts = [], exceptions = []; page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (req.method() === 'POST') posts.push({ url: req.url(), body: req.postDataJSON() }); });
  await page.getByLabel('Name size', { exact: true }).selectOption('large');
  expect(await counters(request)).toMatchObject({ jobs: 0, image_calls: 0, jev_calls: 0 });
  const session = await page.context().newCDPSession(page);
  await session.send('Debugger.enable'); await session.send('Debugger.setPauseOnExceptions', { state: 'all' });
  session.on('Debugger.paused', async event => { exceptions.push(event.data?.description ?? event.reason); await session.send('Debugger.resume'); });
  let response = page.waitForResponse('**/api/apply');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).focus(); await page.keyboard.press('Enter');
  const accepted = await (await response).json(); await expect(page.locator('#status')).toContainText('Apply accepted');
  response = page.waitForResponse('**/api/dispatch'); await page.getByRole('button', { name: 'Validate handoff' }).click();
  const ready = await (await response).json(); expect(ready.operation.logical_operation_id).toBe(accepted.operation_id);
  await expect(page.locator('#status')).toContainText('Typed handoff ready');
  const before = await counters(request); expect(before).toMatchObject({ jobs: 1, image_calls: 0, jev_calls: 0 });
  response = page.waitForResponse('**/api/apply');
  await page.getByRole('button', { name: 'Retry last Apply' }).focus(); await page.keyboard.press('Enter');
  const replay = await (await response).json();
  expect(replay).toMatchObject({ ok: true, code: 'replayed', status: 'ready', replayed: true, operation_id: accepted.operation_id });
  expect(Object.hasOwn(replay, 'operation')).toBe(false); expect(Object.hasOwn(replay, 'result')).toBe(false);
  await expect(page.locator('#status')).toHaveText(`Existing operation acknowledged: ${accepted.operation_id}. No approval or purchase was created.`);
  await expect(page.locator('#draft-state')).toHaveText('Existing operation acknowledged. Validate handoff to review its current typed handoff.');
  await expect(page.getByRole('alert')).toBeHidden(); await expect(page.locator('#artifact')).toBeHidden(); await expect(page.locator('#artwork-preview')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Retry last Apply' })).toBeFocused();
  expect(posts.filter(p => p.url.endsWith('/api/apply'))).toHaveLength(2); expect(posts.filter(p => p.url.endsWith('/api/dispatch'))).toHaveLength(1);
  expect(posts[1].body).toEqual({ operation_id: accepted.operation_id }); expect(posts[2].body).toEqual(posts[0].body);
  expect(await counters(request)).toEqual(before); expect(exceptions).toEqual([]); await session.detach();
  // Foundation has no history endpoint. End the Apply/Validate/Retry handler
  // window before Refresh, and assert its expected unsupported read explicitly.
  const historyResponse = page.waitForResponse('**/api/history');
  await page.getByRole('button', { name: 'Refresh controls' }).click();
  expect((await historyResponse).status()).toBe(404);
  await expect(page.locator('#status')).toHaveText(`Controls refreshed. Existing operation: ${accepted.operation_id}.`);
  await expect(page.getByRole('button', { name: 'Validate handoff' })).toBeEnabled(); await expect(page.getByRole('button', { name: 'Cancel operation' })).toBeEnabled();
  response = page.waitForResponse('**/api/cancel'); await page.getByRole('button', { name: 'Cancel operation' }).click();
  const cancelled = await (await response).json(); expect(cancelled).toMatchObject({ ok: true, code: 'cancelled', operation_id: accepted.operation_id });
  expect(posts.at(-1).body).toEqual({ operation_id: accepted.operation_id }); await expect(page.locator('#status')).toContainText('Operation cancelled');
  expect(await page.locator('body').innerText()).not.toMatch(/Artwork revision saved|Revision saved\./);
  expect(await counters(request)).toEqual(before); expect(errors).toEqual([]); expect(exceptions).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/genuine-ready-apply-replay-cancelled.png', fullPage: true });
  await testInfo.attach('genuine-ready-apply-replay', { body: JSON.stringify({ accepted, ready, replay, cancelled, before, after: await counters(request), posts, errors, exceptions, handler_window: 'Apply/Validate/Retry; foundation Refresh history read explicitly returns404', synthetic_response_injection: false, live_calls: 0 }), contentType: 'application/json' });
});
