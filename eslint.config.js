import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import a11y from 'eslint-plugin-jsx-a11y';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.fixture-package/**', '.shared-contracts/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{ts,tsx}'], plugins: { 'react-hooks': hooks, 'jsx-a11y': a11y }, rules: { ...hooks.configs.recommended.rules, ...a11y.configs.recommended.rules } },
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', structuredClone: 'readonly' } } },
);
