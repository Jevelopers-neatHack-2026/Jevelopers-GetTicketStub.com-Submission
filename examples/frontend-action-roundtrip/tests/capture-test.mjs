/** Optional exact MOCK browser store custody. This fixture only finalizes the
 * loopback host after a completed case; it cannot issue application authority. */
import { test as base, expect } from '@playwright/test';
export { expect };
export async function resetFixture(request, data = {}) {
  const response = await request.post('/__fixture/reset', { data });
  expect(response.status(), 'Fixture reset must return HTTP 200').toBe(200);
  expect((await response.json()).ok, 'Fixture reset must initialize its host').toBe(true);
}

export const test = base.extend({
  lockLogo: [false, { option: true }],
  retainedStore: [async ({ request, baseURL, context }, use) => {
    await use();
    await context.close();
    if (process.env.CONTROLS_BROWSER_EVIDENCE_DIR && baseURL === 'http://127.0.0.1:4317') {
      const response = await request.post('/__fixture/capture', { data: {} });
      expect(response.ok(), 'Browser store capture must succeed').toBe(true);
      expect((await response.json()).ok).toBe(true);
    }
  }, { auto: true }],
});
