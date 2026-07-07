import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'shared',
    globals: true,
    include: ['**/__tests__/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
});
