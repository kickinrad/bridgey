import { defineProject } from 'vitest/config';
import { resolve } from 'path';

export default defineProject({
  resolve: {
    alias: {
      '#test-utils': resolve(__dirname, '../../dev/test-utils'),
    },
  },
  test: {
    name: 'connect',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
