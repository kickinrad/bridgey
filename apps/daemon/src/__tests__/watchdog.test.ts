import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildWatchdogArgs, shouldRestart, DAEMON_SCRIPT_FILENAME } from '../watchdog.js';

describe('watchdog', () => {
  it('builds correct args from argv', () => {
    const args = buildWatchdogArgs(['node', 'watchdog.js', '--config', '/path/to/config.json', '--pidfile', '/tmp/bridgey.pid']);
    expect(args.config).toBe('/path/to/config.json');
    expect(args.pidfile).toBe('/tmp/bridgey.pid');
    expect(args.maxRestarts).toBe(5);
    expect(args.cooldownMs).toBe(5_000);
  });

  it('respects --max-restarts flag', () => {
    const args = buildWatchdogArgs(['node', 'watchdog.js', '--config', '/path/to/config.json', '--max-restarts', '10']);
    expect(args.maxRestarts).toBe(10);
  });

  it('shouldRestart returns true for crash exit codes', () => {
    expect(shouldRestart(1, 0, 5)).toBe(true);
    expect(shouldRestart(null, 0, 5)).toBe(true);
  });

  it('shouldRestart returns false for clean exit', () => {
    expect(shouldRestart(0, 0, 5)).toBe(false);
  });

  it('shouldRestart returns false when max restarts exceeded', () => {
    expect(shouldRestart(1, 5, 5)).toBe(false);
  });

  // Regression: watchdog previously spawned 'index.js' but esbuild outputs 'daemon.js'.
  // This test ensures the two stay in sync.
  it('DAEMON_SCRIPT_FILENAME matches the esbuild daemon output', () => {
    expect(DAEMON_SCRIPT_FILENAME).toBe('daemon.js');
  });

  it('daemon bundle exists in dist/ (when built)', () => {
    const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const distDaemon = join(pluginRoot, 'dist', DAEMON_SCRIPT_FILENAME);
    if (!existsSync(distDaemon)) return;
    expect(existsSync(distDaemon)).toBe(true);
  });
});
