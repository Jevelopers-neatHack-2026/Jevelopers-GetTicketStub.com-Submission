import { defineConfig } from 'vitest/config';
/** Consumer contract tests need the provisioned, hash-verified archive (`npm run contracts:provision`). */
export default defineConfig({ test: { environment: 'node', include: ['contracts/tests/**/*.test.ts'], clearMocks: true } });
