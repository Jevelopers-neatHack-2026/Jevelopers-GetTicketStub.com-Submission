import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
const packageRoot = resolve('.fixture-package/package/dist');
export default defineConfig({
  root: resolve('integration/fixture-host'), plugins: [react()],
  resolve: { alias: [
    { find: '@jevelopers/team-dashboard/integration', replacement: `${packageRoot}/integration.js` },
    { find: '@jevelopers/team-dashboard/style.css', replacement: `${packageRoot}/team-dashboard.css` },
    { find: '@jevelopers/team-dashboard', replacement: `${packageRoot}/index.js` },
  ], dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: Number(process.env.TD_TEST_PORT ?? 49171), strictPort: true },
});
