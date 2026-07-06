import { defineProject } from 'vitest/config';
import { resolve } from 'path';

export default defineProject({
  resolve: {
    alias: {
      '#test-utils': resolve(__dirname, 'src/__tests__/utils'),
    },
  },
  test: {
    name: 'daemon',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/__tests__/manual/**'],
  },
});
