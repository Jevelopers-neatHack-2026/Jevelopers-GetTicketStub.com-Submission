import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', outputDir: new URL('./test-results/', import.meta.url).pathname, fullyParallel: false, workers: 1, retries: 0,
  use: { browserName: 'chromium', headless: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'foundation', testMatch: 'roundtrip.spec.mjs', use: { baseURL: 'http://127.0.0.1:4318' } },
    { name: 'actual-api', testMatch: ['integrated.spec.mjs', 'inspection-presentation.spec.mjs'], use: { baseURL: 'http://127.0.0.1:4317' } },
  ],
  webServer: [
    { command: 'CONTROLS_FIXTURE_PORT=4318 node foundation-server.mjs', url: 'http://127.0.0.1:4318', reuseExistingServer: false },
    { command: 'node server.mjs', url: 'http://127.0.0.1:4317', reuseExistingServer: false },
  ],
});
