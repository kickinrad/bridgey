import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const testDir = join(tmpdir(), `bridgey-tailscale-config-test-${process.pid}`);
  const configPath = join(testDir, 'bridgey-tailscale.config.json');

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  it('returns defaults when no path is provided', () => {
    const config = loadConfig();

    expect(config).toEqual({
      bridgey_port: 8092,
      probe_timeout_ms: 2000,
      exclude_peers: [],
      scan_on_session_start: true,
    });
  });

  it('returns defaults when config file does not exist', () => {
    const config = loadConfig('/tmp/definitely-does-not-exist.json');

    expect(config).toEqual({
      bridgey_port: 8092,
      probe_timeout_ms: 2000,
      exclude_peers: [],
      scan_on_session_start: true,
    });
  });

  it('loads valid config from JSON file', () => {
    writeFileSync(configPath, JSON.stringify({
      bridgey_port: 9999,
      probe_timeout_ms: 5000,
      exclude_peers: ['printer', 'nas'],
      scan_on_session_start: false,
    }));

    const config = loadConfig(configPath);

    expect(config.bridgey_port).toBe(9999);
    expect(config.probe_timeout_ms).toBe(5000);
    expect(config.exclude_peers).toEqual(['printer', 'nas']);
    expect(config.scan_on_session_start).toBe(false);
  });

  it('merges partial config with defaults', () => {
    writeFileSync(configPath, JSON.stringify({
      bridgey_port: 3000,
    }));

    const config = loadConfig(configPath);

    expect(config.bridgey_port).toBe(3000);
    expect(config.probe_timeout_ms).toBe(2000);
    expect(config.exclude_peers).toEqual([]);
    expect(config.scan_on_session_start).toBe(true);
  });

  it('handles malformed JSON gracefully', () => {
    writeFileSync(configPath, '{ not valid json !!!');

    const config = loadConfig(configPath);

    expect(config).toEqual({
      bridgey_port: 8092,
      probe_timeout_ms: 2000,
      exclude_peers: [],
      scan_on_session_start: true,
    });
  });

  it('returns a new object each time (not the same reference)', () => {
    const config1 = loadConfig();
    const config2 = loadConfig();

    expect(config1).not.toBe(config2);
  });

  it('shares default array references via shallow spread (known limitation)', () => {
    // loadConfig uses { ...DEFAULTS } which is a shallow copy.
    // Mutating the exclude_peers array on one config will affect the DEFAULTS object.
    // This documents current behavior — a deep clone would be safer.
    const config1 = loadConfig();
    config1.exclude_peers.push('test');
    const config2 = loadConfig();
    expect(config2.exclude_peers).toContain('test');
  });
});
