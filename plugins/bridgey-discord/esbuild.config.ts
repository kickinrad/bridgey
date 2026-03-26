import { build } from 'esbuild';

await build({
  entryPoints: ['bot.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/bot.js',
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  // discord.js uses dynamic require() internally — must stay external
  external: ['discord.js', 'zod'],
});

console.log('Build complete: dist/bot.js');
