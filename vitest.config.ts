import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    projects: [
      'plugins/bridgey/daemon',
      'plugins/bridgey-tailscale',
      'plugins/bridgey-discord',
    ],
  },
});
