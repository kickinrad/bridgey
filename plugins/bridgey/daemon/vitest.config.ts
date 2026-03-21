import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'daemon',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/__tests__/manual/**'],
  },
});
