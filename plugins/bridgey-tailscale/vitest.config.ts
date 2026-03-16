import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'tailscale',
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
