import { build } from 'esbuild';

// Bundle MCP channel server
await build({
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.js',
});

console.log('Build complete: dist/server.js');
