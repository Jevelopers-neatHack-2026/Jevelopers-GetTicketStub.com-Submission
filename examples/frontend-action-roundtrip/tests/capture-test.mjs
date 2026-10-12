/** Optional exact MOCK browser store custody. This fixture only finalizes the
 * loopback host after a completed case; it cannot issue application authority. */
import { test as base, expect } from '@playwright/test';
export { expect };
export const test = base.extend({
  retainedStore: [async ({ request, baseURL }, use) => {
    await use();
    if (process.env.CONTROLS_BROWSER_EVIDENCE_DIR && baseURL === 'http://127.0.0.1:4317') {
      const response = await request.post('/__fixture/capture', { data: {} });
      expect(response.ok(), 'Browser store capture must succeed').toBe(true);
      expect((await response.json()).ok).toBe(true);
    }
  }, { auto: true }],
});
