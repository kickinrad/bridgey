import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
