import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: { index: resolve('src/package.ts'), integration: resolve('integration/index.ts'), server: resolve('src/server.ts') }, formats: ['es'], cssFileName: 'team-dashboard' },
    rolldownOptions: { external: [/^react(?:\/|$)/, /^react-dom(?:\/|$)/], output: { banner: (chunk) => chunk.name === 'index' ? '"use client";' : '' } },
  },
});
