import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '模块化开发及技术验证成果', '已有后端', '.trellis', '.agents'] },
  { extends: [js.configs.recommended, ...tseslint.configs.recommended], files: ['**/*.{ts,tsx}'], languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.worker } }, plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh }, rules: { ...reactHooks.configs.recommended.rules, 'react-hooks/refs': 'off', 'react-hooks/set-state-in-effect': 'off', 'react-hooks/immutability': 'off', 'react-hooks/purity': 'off', 'react-refresh/only-export-components': ['warn', { allowConstantExport: true }], '@typescript-eslint/no-explicit-any': 'off' } },
);
