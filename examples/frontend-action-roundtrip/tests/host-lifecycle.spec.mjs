import { test, expect, resetFixture } from './capture-test.mjs';
const state = async request => (await request.get('/__fixture/lifecycle')).json();
for (const operation of ['reset', 'capture']) test(`${operation} waits for an admitted current read and leaves fresh UI initialization healthy`, async ({ page, request }) => {
  await resetFixture(request, { lock_logo: true }); await page.goto('/composition.html');
  await expect(page.locator('#composition-status')).toContainText('not initialized');
  await page.getByLabel('I reviewed the selected artwork and initialization binding.').check();
  const response = page.waitForResponse('**/api/composition/apply'); await page.getByRole('button', { name: 'Initialize reviewed composition' }).click();
  expect((await (await response).json()).result.ok).toBe(true);
  await expect(page.locator('#preview-status')).toContainText('Both exact byte hashes verified');
  expect((await request.post('/__fixture/state', { data: { block: 'composition-current' } })).ok()).toBe(true);
  const read = request.get('/api/composition/current');
  await expect.poll(async () => (await state(request)).waiting).toBe('composition-current');
  let completed = false;
  const transition = request.post(`/__fixture/${operation}`, { data: operation === 'reset' ? { lock_logo: true } : {} }).then(value => { completed = true; return value; });
  try {
    await expect.poll(async () => (await state(request)).retiring).toBe(true);
    expect(await state(request)).toMatchObject({ active: 1, closed: false, finalized: false }); expect(completed).toBe(false);
  } finally {
    expect((await request.post('/__fixture/state', { data: { release: true } })).ok()).toBe(true);
  }
  const original = await read; expect(original.status()).toBe(200); expect((await original.json()).view.status).toBe('current');
  const changed = await transition; expect(changed.status()).toBe(200); expect((await changed.json()).ok).toBe(true);
  if (operation === 'capture') await resetFixture(request, { lock_logo: true });
  expect((await request.get('/api/schema')).status()).toBe(200);
  const current = await request.get('/api/composition/current'); expect(current.status()).toBe(200); expect((await current.json()).view.status).toBe('not_initialized');
  await page.reload(); await expect(page.locator('#composition-status')).toContainText('not initialized');
});
