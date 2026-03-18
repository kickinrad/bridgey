import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 60,
        branches: 50,
        functions: 60,
      },
    },
    projects: [
      'plugins/bridgey/daemon',
      'plugins/bridgey/server',
      'plugins/bridgey-tailscale',
      'plugins/bridgey-discord',
    ],
  },
});
