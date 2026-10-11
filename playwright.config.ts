import { defineConfig } from '@playwright/test';
const port = Number(process.env.TD_TEST_PORT ?? 49171);
const artifacts = process.env.TD_ARTIFACT_DIR ?? 'test-results';
export default defineConfig({
  testDir: './tests', outputDir: artifacts, fullyParallel: false, workers: 1,
  reporter: [['list'], ['json', { outputFile: `${artifacts}/results.json` }]],
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build && node scripts/prepare-fixture.mjs && vite --config integration/fixture-host/vite.config.ts', url: `http://127.0.0.1:${port}/admin/finance`, reuseExistingServer: false, timeout: 120000 },
  projects: [{ name: 'e2e', testMatch: '**/e2e/*.spec.ts' }, { name: 'integration', testMatch: '**/integration/*.spec.ts' }],
});
