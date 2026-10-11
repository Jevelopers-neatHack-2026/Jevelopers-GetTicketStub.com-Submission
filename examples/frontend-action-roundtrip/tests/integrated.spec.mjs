import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { canonical } from '../../../src/controls/schema.mjs';
import AxeBuilder from '@axe-core/playwright';
const rehash = body => { body.draft_hash = createHash('sha256').update(canonical(body.draft)).digest('hex'); };
const counters = async request => (await request.get('/api/counters')).json();
test.beforeEach(async ({ page, request }) => {
  await request.post('/__fixture/reset', { data: {} }); await page.goto('/');
  await expect(page.getByLabel('Artwork style')).toBeVisible();
});

for (const format of ['png', 'jpeg', 'webp']) test(`keyboard draft/followup/locks/axe then explicit native ${format} Apply reaches actual durable API artifact`, async ({ page, request }, testInfo) => {
  await request.post('/__fixture/reset', { data: { native_format: format } }); await page.goto('/');
  await expect(page.getByLabel('Artwork style')).toBeVisible();
  const original = (await (await request.get('/api/history')).json()).selection;
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  let sent; page.on('request', req => { if (req.url().endsWith('/api/apply')) sent ??= req.postDataJSON(); });
  const posts = []; page.on('request', req => { if (req.method() === 'POST') posts.push(req.url()); });
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Name size', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Layout', { exact: true })).toBeFocused();
  await page.keyboard.press('s'); await expect(page.getByLabel('Stacked layout emphasis')).toBeVisible();
  await expect(page.getByLabel('Approved logo position')).toBeDisabled();
  await expect(page.getByLabel('Approved logo position')).toHaveAttribute('aria-describedby', 'lock-c03');
  await page.getByLabel('Layout', { exact: true }).selectOption('centered'); await expect(page.getByLabel('Stacked layout emphasis')).toHaveCount(0);
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Artwork style')).toBeFocused();
  await page.keyboard.press('v'); expect(posts).toEqual([]);
  expect(await counters(request)).toMatchObject({ jobs: 0, image_calls: 0, jev_calls: 0, reservations: 0, bootstrap_image_calls: 1 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const responsePromise = page.waitForResponse('**/api/apply');
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeFocused();
  await page.keyboard.press('Enter'); const result = await (await responsePromise).json();
  expect(result.ok).toBe(true); expect(result.code).toBe('completed');
  expect(result.result.design_version.artifact.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(result.result.design_version.logical_operation_id).toBe(result.action_id);
  await expect(page.locator('#status')).toContainText('Artwork revision saved');
  await expect(page.locator('#artifact')).toContainText(result.result.design_version.artifact.content_hash);
  const image = page.getByRole('img', { name: 'Saved artwork from the immutable local version' });
  await expect(image).toBeVisible();
  await expect.poll(async () => image.evaluate(el => el.complete && el.naturalWidth === 16 && el.naturalHeight === 16)).toBe(true);
  const artifact = await request.get(`/api/artifact?design_version_id=${encodeURIComponent(result.result.design_version.design_version_id)}`);
  expect(artifact.headers()['content-type']).toBe(`image/${format}`);
  const bytes = await artifact.body();
  if (format === 'png') expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(result.result.design_version.artifact.content_hash);
  const history = await (await request.get('/api/history')).json();
  expect(history.result.items).toHaveLength(2);
  expect(history.result.items.some(item => item.design_hash === result.result.design_version.design_hash)).toBe(true);
  expect(await counters(request)).toMatchObject({ jobs: 1, image_calls: 1, jev_calls: 0, reservations: 1 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/actual-api-roundtrip-${format}.png`, fullPage: true });
  const captured = await captureHandlerExceptions(page);
  const evidence = await (await request.get(`/__fixture/native-evidence?action_id=${encodeURIComponent(result.action_id)}`)).json();
  const parentBytes = await (await request.get(`/api/artifact?design_version_id=${encodeURIComponent(original.design_version_id)}`)).body();
  expect(result.result.design_version.parent_version_id).toBe(original.design_version_id);
  expect(evidence.captures.at(-1)).toMatchObject({ operation: 'edit', parent: {
    content_hash: `sha256:${createHash('sha256').update(parentBytes).digest('hex')}`, media_type: `image/${format}`, byte_length: parentBytes.length },
    output: { content_hash: result.result.design_version.artifact.content_hash, media_type: `image/${format}`, byte_length: bytes.length } });
  expect(evidence.private_usage_sha256).toBe(evidence.verified_private_usage_sha256);
  expect(evidence).toMatchObject({ raw_completeness: 'unknown', raw_missing_fields: ['usage.profile_mapping_pending'], mapping_status: 'settled_owner_mapping', billable_attempt_id: result.result.design_version.billable_attempt_id });
  expect(evidence.attempt_binding_sha256).toMatch(/^sha256:[a-f0-9]{64}$/); expect(evidence.target_binding_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toMatch(/synthetic-offline-token|req-controls-private-synthetic|mock-owner-profile/);
  const before = await counters(request);
  const replay = await (await request.post('/api/apply', { data: sent })).json();
  expect(replay.result).toEqual(result.result); expect(replay.backend_job_id).toBe(result.backend_job_id);
  await expect(page.getByLabel('Historical artwork version').locator('option')).toHaveCount(2);
  await page.getByLabel('Historical artwork version').selectOption(original.design_version_id);
  await page.getByRole('button', { name: 'Compare with current' }).click();
  await expect(page.locator('#history-result')).toContainText(`Compared exact hashes ${result.result.design_version.artifact.content_hash}`);
  await page.getByRole('button', { name: 'Restore by selection' }).click();
  await expect(page.locator('#history-result')).toContainText(original.design_version_id);
  await expect(page.getByLabel('Artwork style')).toHaveValue('calm');
  await expect.poll(async () => image.evaluate(el => el.complete && el.naturalWidth === 16 && el.naturalHeight === 16)).toBe(true);
  expect((await (await request.get('/api/history')).json()).selection.design_version_id).toBe(original.design_version_id);
  const historicalReplay = await (await request.post('/api/apply', { data: sent })).json();
  expect(historicalReplay.result).toEqual(result.result); expect(await counters(request)).toEqual(before);
  await page.route('**/api/apply', route => route.continue({ postData: JSON.stringify({ ...sent, action_id: `stale-${format}` }) }));
  await page.getByLabel('Artwork style').selectOption('vibrant');
  const staleResponse = page.waitForResponse('**/api/apply'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const stale = await (await staleResponse).json(); expect(stale.ok).toBe(false); expect(stale.code).toBe('stale_version');
  await expect(page.getByRole('alert')).toBeFocused(); await expect(page.getByRole('alert')).toContainText('Refresh controls');
  expect(await counters(request)).toEqual(before);
  expect(captured.exceptions).toEqual([]); expect(pageErrors).toEqual([]); await captured.session.detach();
  const pageText = await page.locator('body').innerText(); expect(pageText).not.toMatch(/synthetic-offline-token|req-controls-private-synthetic|mock-owner-profile/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await testInfo.attach(`actual-native-${format}-result`, { body: JSON.stringify({ result, replay, historicalReplay, stale, evidence, counters: before, exceptions: captured.exceptions, page_errors: pageErrors,
    fidelity: format === 'png' ? 'Distinct fixture pixels only; no model quality proof' : 'Static valid codec sample; no visual edit quality proof',
    public_result_sha256: createHash('sha256').update(JSON.stringify(result)).digest('hex'), live_application_calls: 0 }), contentType: 'application/json' });
});

test('native usage without declared MOCK owner map keeps hold and truthful recovery after one intercepted POST', async ({ page, request }, testInfo) => {
  const original = (await (await request.get('/api/history')).json()).selection;
  await request.post('/__fixture/state', { data: { map_native_usage: false } });
  let body; page.on('request', req => { if (req.url().endsWith('/api/apply')) body = req.postDataJSON(); });
  await page.getByLabel('Artwork style').selectOption('vibrant');
  const pending = page.waitForResponse('**/api/apply'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const result = await (await pending).json(); expect(result.ok).toBe(false);
  await expect(page.getByRole('alert')).toContainText('reservation may remain held');
  await expect(page.getByRole('alert')).toBeFocused(); await expect(page.locator('#artwork-preview')).toBeHidden();
  expect(await counters(request)).toMatchObject({ image_calls: 1, reservations: 1, holds: 1, releases: 0 });
  const replay = await (await request.post('/api/apply', { data: body })).json();
  expect(replay.backend_job_id).toBe(result.backend_job_id); expect(replay.ok).toBe(false);
  expect(await counters(request)).toMatchObject({ image_calls: 1, reservations: 1, holds: 1, releases: 0 });
  expect((await (await request.get('/api/history')).json()).selection).toEqual(original);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await testInfo.attach('native-unmapped-result', { body: JSON.stringify({ result, replay, counts: await counters(request), live_application_calls: 0 }), contentType: 'application/json' });
});

for (const mode of ['revocation', 'cancel']) test(`native post-ACK ${mode} prevents offline POST and publication while preserving unresolved hold`, async ({ page, request }) => {
  const original = (await (await request.get('/api/history')).json()).selection;
  await request.post('/__fixture/state', { data: { block: 'native-post-ack' } });
  await page.getByLabel('Artwork style').selectOption('vibrant');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect.poll(async () => (await counters(request)).transport_acks).toBe(1);
  if (mode === 'cancel') await page.getByRole('button', { name: 'Cancel operation' }).click();
  await request.post('/__fixture/state', { data: { ...(mode === 'revocation' ? { revoke_asset: true } : {}), release: true } });
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await counters(request)).toMatchObject({ image_calls: 0, reservations: 1, holds: 1, releases: 0 });
  const history = await (await request.get('/api/history')).json(); expect(history.result.items).toHaveLength(1); expect(history.selection).toEqual(original);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('lost response, concurrent duplicates and adapter restart recover same actual job/hash with one transport', async ({ page, request }) => {
  let sent, first;
  await page.route('**/api/apply', async route => { sent = route.request().postDataJSON(); first = await (await route.fetch()).json(); await route.abort('failed'); });
  await page.getByLabel('Artwork style').selectOption('vibrant'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Retry last Apply'); await expect(page.getByRole('alert')).toBeFocused();
  await page.unroute('**/api/apply'); await request.post('/__fixture/state', { data: { restart: true } });
  await page.getByRole('button', { name: 'Retry last Apply' }).click(); await expect(page.locator('#status')).toContainText('Existing operation returned');
  const responses = await Promise.all([request.post('/api/apply', { data: sent }), request.post('/api/apply', { data: sent })]);
  const results = await Promise.all(responses.map(res => res.json()));
  expect(results.every(result => result.backend_job_id === first.backend_job_id && result.result.design_version.artifact.content_hash === first.result.design_version.artifact.content_hash)).toBe(true);
  expect(await counters(request)).toMatchObject({ jobs: 1, image_calls: 1, jev_calls: 0, reservations: 1 });
});

for (const [label, mutate, code] of [
  ['tenant', body => { body.tenant_id = 'forged'; }, 'Permission denied'], ['project', body => { body.project_id = 'forged'; }, 'Permission denied'],
  ['unknown HTML field', body => { body.html = '<script>window.attack=true</script>'; }, 'Unsupported action fields'],
  ['privileged action', body => { body.intent = 'approve'; }, 'Unsupported action. Only explicit Apply'],
  ['unsupported schema', body => { body.schema_version = 'creative-controls/9'; }, 'Unsupported controls version'],
  ['invalid option', body => { body.draft.selections.c04 = '<script>window.attack=true</script>'; rehash(body); }, 'Unsupported selection'],
  ['unknown control', body => { body.draft.selections.zz = 'unrecognized'; rehash(body); }, 'Invalid Apply request'],
  ['tampered lock', body => { body.draft.selections.c03 = 'bottom'; rehash(body); }, 'locked'],
]) test(`actual browser ${label} rejects before backend job/attempt`, async ({ page, request }) => {
  await page.route('**/api/apply', async route => { const body = route.request().postDataJSON(); mutate(body); await route.continue({ postData: JSON.stringify(body) }); });
  await page.getByLabel('Artwork style').selectOption('vibrant'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(code); await expect(page.getByRole('alert')).toBeFocused();
  expect(await counters(request)).toMatchObject({ jobs: 0, image_calls: 0, reservations: 0 });
  expect(await page.evaluate(() => window.attack)).toBeUndefined();
});

test('source invalidation after draft denies actual Apply and keeps exact historical artifact', async ({ page, request }) => {
  await page.getByLabel('Artwork style').selectOption('vibrant'); await request.post('/__fixture/state', { data: { invalidate: true } });
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Permission denied');
  expect(await counters(request)).toMatchObject({ jobs: 0, image_calls: 0, reservations: 0 });
  expect((await (await request.get('/api/history')).json()).result.items).toHaveLength(1);
});

test('missing composition consumer is explicit typed unavailable with durable task and zero attempts', async ({ page, request }) => {
  await page.getByLabel('Name size', { exact: true }).selectOption('large');
  const responsePromise = page.waitForResponse('**/api/apply'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const result = await (await responsePromise).json(); expect(result.pending_bridge).toBe('creative.composition.consume/1');
  await expect(page.getByRole('alert')).toContainText('Handoff unavailable');
  await expect(page.getByRole('alert')).toContainText('this action did not dispatch an image or reserve funds');
  expect(await counters(request)).toMatchObject({ jobs: 1, image_calls: 0, jev_calls: 0, reservations: 0 });
  await page.getByRole('button', { name: 'Cancel operation' }).click(); await expect(page.locator('#status')).toContainText('Operation cancelled');
});

test('cancel while actual provider awaits preserves Finance hold and prevents late publication', async ({ page, request }) => {
  await request.post('/__fixture/state', { data: { block: 'provider' } });
  await page.getByLabel('Artwork style').selectOption('vibrant'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect.poll(async () => (await counters(request)).image_calls).toBe(1);
  await page.getByRole('button', { name: 'Cancel operation' }).click(); await expect(page.locator('#status')).toContainText('Operation cancelled');
  expect(await counters(request)).toMatchObject({ holds: 1, releases: 0, image_calls: 1 });
  await request.post('/__fixture/state', { data: { release: true } });
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await (await request.get('/api/history')).json()).result.items).toHaveLength(1);
  expect(await counters(request)).toMatchObject({ jobs: 1, image_calls: 1, releases: 0 });
});

test('rights revoked while Finance acknowledgment awaits stop transport and publication', async ({ page, request }) => {
  await request.post('/__fixture/state', { data: { block: 'reservation' } });
  await page.getByLabel('Artwork style').selectOption('vibrant'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect.poll(async () => (await counters(request)).reservations).toBe(1);
  await request.post('/__fixture/state', { data: { revoke: true, release: true } });
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await counters(request)).toMatchObject({ image_calls: 0, reservations: 1 });
  expect((await (await request.get('/api/history')).json()).result.items).toHaveLength(1);
});

test('history compare/restore consumes exact stored hashes with zero additional image calls and fresh control selection', async ({ page, request }) => {
  const original = (await (await request.get('/api/history')).json()).selection;
  await page.getByLabel('Artwork style').selectOption('vibrant'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('#status').first()).toContainText('Artwork revision saved');
  await expect(page.getByLabel('Historical artwork version').locator('option')).toHaveCount(2);
  await page.getByLabel('Historical artwork version').selectOption(original.design_version_id);
  await page.getByRole('button', { name: 'Compare with current' }).click(); await expect(page.locator('#history-result')).toContainText('Compared exact hashes');
  await page.getByRole('button', { name: 'Restore by selection' }).click(); await expect(page.locator('#history-result')).toContainText(original.design_version_id);
  await expect(page.getByLabel('Artwork style')).toHaveValue('calm');
  expect(await counters(request)).toMatchObject({ jobs: 1, image_calls: 1, jev_calls: 0, reservations: 1 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('revocation during actual final storage await prevents committed artwork and successful UI acknowledgment', async ({ page, request }) => {
  await request.post('/__fixture/state', { data: { block: 'publication' } });
  await page.getByLabel('Artwork style').selectOption('vibrant'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect.poll(async () => (await counters(request)).publication_waits).toBe(1);
  await request.post('/__fixture/state', { data: { revoke: true, release: true } });
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.locator('#artifact')).toBeHidden();
  expect((await (await request.get('/api/history')).json()).result.items).toHaveLength(1);
  expect(await counters(request)).toMatchObject({ image_calls: 1, reservations: 1, jobs: 1 });
});

for (const mode of ['later edit', 'restore']) test(`completed historical Apply replay after ${mode} preserves original result and today's selection without additional calls`, async ({ page, request }) => {
  const original = (await (await request.get('/api/history')).json()).selection;
  let firstAction; await page.route('**/api/apply', async route => { firstAction ??= route.request().postDataJSON(); await route.continue(); });
  await page.getByLabel('Artwork style').selectOption('vibrant');
  const firstPromise = page.waitForResponse('**/api/apply'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const first = await (await firstPromise).json(); expect(first.ok).toBe(true);
  await expect(page.locator('#status')).toContainText('Artwork revision saved');
  if (mode === 'later edit') {
    await page.getByRole('button', { name: 'Refresh controls', exact: true }).click();
    await expect(page.locator('#status')).toContainText('Controls refreshed');
    await expect(page.getByLabel('Artwork style')).toHaveValue('vibrant');
    await page.getByLabel('Artwork style').selectOption('calm');
    const secondPromise = page.waitForResponse('**/api/apply'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    expect((await (await secondPromise).json()).ok).toBe(true);
    expect((await counters(request)).image_calls).toBe(2);
    await expect(page.locator('#status')).toContainText('Artwork revision saved');
  } else {
    await page.getByLabel('Historical artwork version').selectOption(original.design_version_id);
    await page.getByRole('button', { name: 'Restore by selection' }).click();
    await expect(page.locator('#history-result')).toContainText(original.design_version_id);
  }
  const before = await counters(request), selected = (await (await request.get('/api/history')).json()).selection;
  const replay = await (await request.post('/api/apply', { data: firstAction })).json();
  expect(replay.ok).toBe(true); expect(replay.code).toBe('replayed'); expect(replay.backend_job_id).toBe(first.backend_job_id);
  expect(replay.request_hash).toBe(first.request_hash); expect(replay.result).toEqual(first.result);
  expect(await counters(request)).toEqual(before);
  expect((await (await request.get('/api/history')).json()).selection).toEqual(selected);
  await expect(page.getByLabel('Artwork style')).toHaveValue('calm');
});

test('browser public renderer screens embedded synthetic credential IDs and preserves benign opaque IDs', async ({ page, request }) => {
  const schema = (await (await request.get('/api/schema')).json()).schema;
  const result = await page.evaluate(async input => {
    const { assertRenderableSchema } = await import('/schema.mjs');
    const values = ['design.ghp_' + 'a'.repeat(36), 'id.Basic+' + btoa('fixture:inert'), 'id.Bearer+inert-test', 'id.212-555-0100'];
    const rejected = values.map(value => { const copy = structuredClone(input); copy.expected_versions.design = value;
      try { assertRenderableSchema(copy); return false; } catch { return true; } });
    const benign = structuredClone(input); benign.expected_versions.design = 'design:abc.def+revision_2';
    return { rejected, benign: assertRenderableSchema(benign).expected_versions.design };
  }, schema);
  expect(result.rejected).toEqual([true, true, true, true]); expect(result.benign).toBe('design:abc.def+revision_2');
  expect(await counters(request)).toMatchObject({ jobs: 0, image_calls: 0, reservations: 0 });
});

for (const [fault, code, holds] of [['connection-loss', 'unavailable', 1], ['artifact-hash', 'failed', 0]]) {
  test(`actual browser post-dispatch ${fault} shows truthful failure and retains the existing operation`, async ({ page, request }, testInfo) => {
    await request.post('/__fixture/state', { data: { provider_fault: fault } });
    await page.getByLabel('Artwork style').selectOption('vibrant');
    const response = page.waitForResponse('**/api/apply'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    const result = await (await response).json(); expect(result.ok).toBe(false); expect(result.code).toBe(code);
    const alert = page.getByRole('alert'); await expect(alert).toBeFocused(); await expect(alert).toContainText('may have been dispatched');
    await expect(alert).not.toContainText('no paid call'); await expect(alert).not.toContainText('No operation was dispatched');
    await expect(page.locator('#status')).toContainText(result.operation_id);
    expect(await counters(request)).toMatchObject({ jobs: 1, image_calls: 1, reservations: 1, holds, releases: 0 });
    expect((await (await request.get('/api/history')).json()).result.items).toHaveLength(1);
    if (fault === 'connection-loss') await expect(alert).toContainText('reservation may remain held');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await testInfo.attach('postdispatch-actual-api-result', { body: JSON.stringify(result), contentType: 'application/json' });
    await page.screenshot({ path: `test-results/postdispatch-${fault}.png`, fullPage: true });
  });
}


// Observe caught handler exceptions as well as pageerror: the old outer catch hid
// the removed-map ReferenceError from pageerror and replaced typed API guidance.
async function captureHandlerExceptions(page) {
  const session = await page.context().newCDPSession(page), exceptions = [];
  await session.send('Debugger.enable'); await session.send('Debugger.setPauseOnExceptions', { state: 'all' });
  session.on('Debugger.paused', async event => { exceptions.push(event.data?.description ?? event.reason); await session.send('Debugger.resume'); });
  return { exceptions, session };
}

for (const [label, code] of [
  ['unknown', 'unrecognized_failure'], ['synthetic GitHub', 'ghp_SyntheticCredentialValueSyntheticCredentialValue'],
  ['synthetic Bearer', 'Bearer synthetic-private-error-token'], ['prototype', '__proto__'], ['constructor', 'constructor'],
  ['missing', undefined], ['null', null], ['number', 42], ['object', { private: 'Bearer synthetic-private-error-token' }],
  ['array', ['ghp_SyntheticCredentialValueSyntheticCredentialValue']],
]) test(`malformed Apply error ${label} uses focused fixed recovery text without disclosure or dispatch`, async ({ page, request }, testInfo) => {
  const before = await counters(request), selection = (await (await request.get('/api/history')).json()).selection;
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  const captured = await captureHandlerExceptions(page); let intercepted = 0;
  // Only the failed Apply response is malformed; the actual server, schema,
  // native bootstrap and read APIs remain unchanged. No success is fabricated.
  await page.route('**/api/apply', route => {
    intercepted++;
    return route.fulfill({ json: { ok: false, code, message: 'Bearer synthetic-private-backend-message' } });
  });
  await page.getByLabel('Artwork style').selectOption('vibrant');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toHaveText('Apply did not complete. Dispatch and reservation status are not confirmed here. Check the existing operation before retrying.');
  await expect(alert).toBeFocused(); expect(intercepted).toBe(1);
  expect(await page.locator('body').innerText()).not.toMatch(/ghp_|Bearer|__proto__|constructor|unrecognized_failure/);
  expect(captured.exceptions).toEqual([]); expect(pageErrors).toEqual([]);
  await captured.session.detach(); // Close the handler window before axe.
  expect(await counters(request)).toEqual(before);
  expect((await (await request.get('/api/history')).json()).selection).toEqual(selection);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(pageErrors).toEqual([]);
  await testInfo.attach('malformed-apply-error-boundary', { body: JSON.stringify({ label, alert: await alert.innerText(),
    focused: await alert.evaluate(el => el === document.activeElement), intercepted, counters: before,
    selection_unchanged: true, exceptions: captured.exceptions, page_errors: pageErrors, live_application_calls: 0 }), contentType: 'application/json' });
  if (label === 'synthetic GitHub') await page.screenshot({ path: 'test-results/apply-unknown-error-fixed.png', fullPage: true });
});

test('stale old-tab Restore keeps actual selection and typed refresh guidance without a caught handler exception', async ({ page, context, request }, testInfo) => {
  await expect(page.getByLabel('Historical artwork version').locator('option')).toHaveCount(1);
  const other = await context.newPage(); await other.goto('http://127.0.0.1:4317/');
  await expect(other.getByLabel('Artwork style')).toBeVisible();
  await other.getByLabel('Artwork style').selectOption('vibrant');
  const applied = other.waitForResponse('**/api/apply'); await other.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const completion = await (await applied).json(); expect(completion.ok).toBe(true);
  await expect(other.locator('#status')).toContainText('Artwork revision saved');
  const before = await counters(request), selected = (await (await request.get('/api/history')).json()).selection;
  expect(selected.revision).toBe(2); expect(before).toMatchObject({ image_calls: 1, reservations: 1 });
  const captured = await captureHandlerExceptions(page);
  const rejected = page.waitForResponse('**/api/restore'); await page.getByRole('button', { name: 'Restore by selection' }).click();
  const result = await (await rejected).json(); expect(result.ok).toBe(false);
  expect(result.error).toMatchObject({ code: 'stale_version', operation: 'restore', field: 'expected_selection_revision' });
  await expect(page.getByRole('alert')).toContainText('Refresh controls'); await expect(page.getByRole('alert')).toContainText('before restoring');
  await expect(page.getByRole('alert')).toBeFocused(); expect(captured.exceptions).toEqual([]);
  await captured.session.detach(); // End the history-handler window before axe runs.
  expect(await counters(request)).toEqual(before);
  expect((await (await request.get('/api/history')).json()).selection).toEqual(selected);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await testInfo.attach('stale-restore-actual-api-result', { body: JSON.stringify({ result, selection: selected, counters: before, exceptions: captured.exceptions }), contentType: 'application/json' });
  await page.screenshot({ path: 'test-results/history-stale-restore.png', fullPage: true });
  await other.close();
});

const unsafeOperationReferences = [
  ['embedded GitHub', 'op.ghp_' + 'a'.repeat(36)], ['embedded API key', 'op.sk-' + 'a'.repeat(24)],
  ['embedded access token', 'op.access_token:synthetic-private'], ['embedded Bearer', 'op.Bearer+synthetic-private-marker'],
  ['signed URL', 'https://example.invalid/object?sig=synthetic-private'], ['null', null], ['number', 42],
  ['object', { private: 'synthetic-private' }], ['array', ['op.synthetic-private']],
];
const fixedReferenceAlert = 'Apply did not complete. Dispatch and reservation status are not confirmed here. Check the existing operation before retrying.';
for (const [label, operation_id] of unsafeOperationReferences) test(`failed Apply ${label} reference is screened before status, recovery state or requests`, async ({ page, request }, testInfo) => {
  const before = await counters(request), selection = (await (await request.get('/api/history')).json()).selection;
  const errors = [], requests = []; page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => requests.push({ url: req.url(), body: req.postData() }));
  const captured = await captureHandlerExceptions(page); let intercepted = 0;
  await page.route('**/api/apply', route => { intercepted++; return route.fulfill({ json: { ok: false, code: 'unavailable', status: 'unknown', operation_id } }); });
  await page.getByLabel('Artwork style').selectOption('vibrant'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(fixedReferenceAlert); await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.locator('#status')).toHaveText('Apply did not complete. Operation reference unavailable. Retry last Apply to recover its identity.');
  await page.getByRole('button', { name: 'Retry last Apply' }).click();
  await expect.poll(() => intercepted).toBe(2); await expect(page.getByRole('alert')).toBeFocused();
  const actions = requests.filter(req => req.url.endsWith('/api/apply')).map(req => JSON.parse(req.body));
  expect(actions).toHaveLength(2); expect(actions[1]).toEqual(actions[0]);
  await page.getByRole('button', { name: 'Refresh controls' }).click();
  await expect(page.locator('#status')).toHaveText('No operation submitted.'); await expect(page.getByRole('button', { name: 'Cancel operation' })).toBeDisabled();
  expect(await page.locator('body').innerText()).not.toMatch(/ghp_|op\.sk-|access_token|Bearer|example\.invalid|synthetic-private/);
  expect(JSON.stringify(requests)).not.toMatch(/ghp_|op\.sk-|access_token|Bearer|example\.invalid|synthetic-private/);
  expect(await counters(request)).toEqual(before); expect((await (await request.get('/api/history')).json()).selection).toEqual(selection);
  expect(captured.exceptions).toEqual([]); expect(errors).toEqual([]); await captured.session.detach();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await testInfo.attach('failed-reference-projection', { body: JSON.stringify({ label, intercepted, alert: fixedReferenceAlert, requests, before, after: await counters(request), exceptions: captured.exceptions, errors, selection_unchanged: true, synthetic_failed_response_only: true }), contentType: 'application/json' });
});

for (const operation_id of ['op.safe-1', 'op.normal:2+v']) test(`failed Apply safe reference ${operation_id} remains visible and available after refresh`, async ({ page, request }) => {
  const before = await counters(request);
  await page.route('**/api/apply', route => route.fulfill({ json: { ok: false, code: 'unavailable', status: 'unknown', operation_id } }));
  await page.getByLabel('Artwork style').selectOption('vibrant'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('reservation may remain held'); await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.locator('#status')).toContainText(operation_id);
  await page.getByRole('button', { name: 'Refresh controls' }).click();
  await expect(page.locator('#status')).toHaveText(`Controls refreshed. Existing operation: ${operation_id}.`);
  await expect(page.getByRole('button', { name: 'Cancel operation' })).toBeEnabled(); expect(await counters(request)).toEqual(before);
});

test('unsafe subsequent failed references preserve actual known operation retry, lookup and cancellation identity', async ({ page, request }, testInfo) => {
  const errors = [], requests = []; page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (req.method() === 'POST') requests.push({ url: req.url(), body: req.postDataJSON() }); });
  const captured = await captureHandlerExceptions(page);
  await request.post('/__fixture/state', { data: { provider_fault: 'connection-loss' } });
  await page.getByLabel('Artwork style').selectOption('vibrant');
  const accepted = page.waitForResponse('**/api/apply'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const known = await (await accepted).json(); expect(known.ok).toBe(false); expect(known.code).toBe('unavailable'); expect(known.operation_id).toMatch(/^op_/);
  await expect(page.locator('#status')).toContainText(known.operation_id);
  const before = await counters(request); expect(before).toMatchObject({ jobs: 1, image_calls: 1, jev_calls: 0, reservations: 1, holds: 1, releases: 0 });
  for (const [, operation_id] of unsafeOperationReferences.slice(0, 5)) {
    await page.route('**/api/apply', route => route.fulfill({ json: { ok: false, code: 'unavailable', status: 'completed', operation_id } }));
    await page.getByRole('button', { name: 'Retry last Apply' }).click();
    await expect(page.getByRole('alert')).toHaveText(fixedReferenceAlert); await expect(page.getByRole('alert')).toBeFocused();
    await expect(page.locator('#status')).toHaveText(`Apply did not complete. Existing operation: ${known.operation_id}.`);
    expect(await counters(request)).toEqual(before); await page.unroute('**/api/apply');
  }
  // A real retry resolves the original stored action, without a new job/send.
  const replayed = page.waitForResponse('**/api/apply'); await page.getByRole('button', { name: 'Retry last Apply' }).click();
  const replay = await (await replayed).json(); expect(replay.operation_id).toBe(known.operation_id); expect(await counters(request)).toEqual(before);
  await page.getByRole('button', { name: 'Refresh controls' }).click();
  await expect(page.locator('#status')).toContainText(known.operation_id); await expect(page.getByRole('button', { name: 'Cancel operation' })).toBeEnabled();
  const cancelled = page.waitForResponse('**/api/cancel'); await page.getByRole('button', { name: 'Cancel operation' }).click();
  expect((await (await cancelled).json()).code).toBe('cancelled'); await expect(page.locator('#status')).toContainText('Operation cancelled');
  expect(requests.at(-1).body).toEqual({ operation_id: known.operation_id });
  const applies = requests.filter(req => req.url.endsWith('/api/apply')); expect(applies.every(req => req.body.action_id === applies[0].body.action_id)).toBe(true);
  expect(JSON.stringify(requests)).not.toMatch(/ghp_|access_token|Bearer|example\.invalid|synthetic-private/);
  expect(await page.locator('body').innerText()).not.toMatch(/ghp_|access_token|Bearer|example\.invalid|synthetic-private/);
  expect(await counters(request)).toEqual(before); expect(captured.exceptions).toEqual([]); expect(errors).toEqual([]); await captured.session.detach();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/failed-operation-reference-fixed.png', fullPage: true });
  await testInfo.attach('actual-recovery-reference-preserved', { body: JSON.stringify({ known, replay, requests, before, after: await counters(request), exceptions: captured.exceptions, errors, live_calls: 0 }), contentType: 'application/json' });
});

test('Compare current read revocation keeps selection and typed permission guidance without a caught handler exception', async ({ page, request }, testInfo) => {
  await expect(page.getByLabel('Historical artwork version').locator('option')).toHaveCount(1);
  const selected = (await (await request.get('/api/history')).json()).selection, before = await counters(request);
  await request.post('/__fixture/state', { data: { revoke_read: true } });
  const captured = await captureHandlerExceptions(page);
  const rejected = page.waitForResponse('**/api/compare'); await page.getByRole('button', { name: 'Compare with current' }).click();
  const result = await (await rejected).json(); expect(result.ok).toBe(false);
  expect(result.error).toMatchObject({ code: 'permission_denied', operation: 'compare' });
  await expect(page.getByRole('alert')).toContainText('Permission denied'); await expect(page.getByRole('alert')).toContainText('current authorized project access');
  await expect(page.getByRole('alert')).toBeFocused(); expect(captured.exceptions).toEqual([]);
  await captured.session.detach(); // End the history-handler window before axe runs.
  expect(await counters(request)).toEqual(before);
  const history = await (await request.get('/api/history')).json(); expect(history.ok).toBe(false);
  expect(history.error.code).toBe('permission_denied'); expect(history.selection).toEqual(selected);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await testInfo.attach('compare-permission-actual-api-result', { body: JSON.stringify({ result, selection: history.selection, counters: before, exceptions: captured.exceptions }), contentType: 'application/json' });
  await page.screenshot({ path: 'test-results/history-permission-compare.png', fullPage: true });
});

for (const format of ['png', 'jpeg', 'webp']) test(`native ${format} browser cancel and unknown-usage error retain saved selection and conservative hold`, async ({ page, request }, testInfo) => {
  await request.post('/__fixture/reset', { data: { native_format: format } }); await page.goto('/');
  await expect(page.getByLabel('Artwork style')).toBeVisible();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  const captured = await captureHandlerExceptions(page);
  const original = (await (await request.get('/api/history')).json()).selection;
  await request.post('/__fixture/state', { data: { block: 'native-post-ack' } });
  await page.getByLabel('Artwork style').selectOption('vibrant');
  const cancelledResponse = page.waitForResponse('**/api/apply');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect.poll(async () => (await counters(request)).transport_acks).toBe(1);
  await page.getByRole('button', { name: 'Cancel operation' }).click();
  await request.post('/__fixture/state', { data: { release: true } });
  const cancelled = await (await cancelledResponse).json(); expect(cancelled.ok).toBe(false);
  await expect(page.getByRole('alert')).toBeVisible();
  const cancelledCounts = await counters(request);
  expect(cancelledCounts).toMatchObject({ image_calls: 0, reservations: 1, holds: 1, releases: 0 });
  expect((await (await request.get('/api/history')).json()).selection).toEqual(original);
  await expect(page.locator('#artwork-preview')).toBeHidden();
  await request.post('/__fixture/reset', { data: { native_format: format } }); await page.goto('/');
  await expect(page.getByLabel('Artwork style')).toBeVisible();
  const selected = (await (await request.get('/api/history')).json()).selection;
  await request.post('/__fixture/state', { data: { map_native_usage: false } });
  let sent; page.on('request', req => { if (req.url().endsWith('/api/apply')) sent = req.postDataJSON(); });
  await page.getByLabel('Artwork style').selectOption('vibrant');
  const failureResponse = page.waitForResponse('**/api/apply'); await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const failed = await (await failureResponse).json(); expect(failed.ok).toBe(false);
  await expect(page.getByRole('alert')).toContainText('reservation may remain held'); await expect(page.getByRole('alert')).toBeFocused();
  const failureCounts = await counters(request); expect(failureCounts).toMatchObject({ image_calls: 1, reservations: 1, holds: 1, releases: 0 });
  const replay = await (await request.post('/api/apply', { data: sent })).json();
  expect(replay.backend_job_id).toBe(failed.backend_job_id); expect(replay.ok).toBe(false); expect(await counters(request)).toEqual(failureCounts);
  const history = await (await request.get('/api/history')).json(); expect(history.result.items).toHaveLength(1); expect(history.selection).toEqual(selected);
  expect(captured.exceptions).toEqual([]); expect(pageErrors).toEqual([]); await captured.session.detach();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/native-${format}-unknown-usage.png`, fullPage: true });
  await testInfo.attach(`actual-native-${format}-cancel-error`, { body: JSON.stringify({ cancelled, cancelledCounts, failed, replay, failureCounts,
    selected, selection_unchanged: true, exceptions: captured.exceptions, page_errors: pageErrors, live_application_calls: 0 }), contentType: 'application/json' });
});
