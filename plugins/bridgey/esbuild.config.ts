import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node' as const,
  target: 'node22',
  format: 'esm' as const,
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
};

// Bundle daemon
await build({
  ...shared,
  entryPoints: ['daemon/src/index.ts'],
  outfile: 'dist/daemon.js',
});

// Bundle watchdog
await build({
  ...shared,
  entryPoints: ['daemon/src/watchdog.ts'],
  outfile: 'dist/watchdog.js',
});

// Bundle MCP server
await build({
  ...shared,
  entryPoints: ['server/src/index.ts'],
  outfile: 'dist/server.js',
});

// Bundle tailscale scan CLI (used by SessionStart hook)
await build({
  ...shared,
  entryPoints: ['daemon/src/tailscale/scan-cli.ts'],
  outfile: 'dist/scan-cli.js',
});

console.log('Build complete: dist/daemon.js, dist/watchdog.js, dist/server.js, dist/scan-cli.js');
