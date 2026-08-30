import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/client/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/模块化开发及技术验证成果/**'],
  },
});
