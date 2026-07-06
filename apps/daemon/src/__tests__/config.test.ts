import { describe, it, expect } from 'vitest';
import { parseConfig } from '../config.js';

const FULL_CONFIG = JSON.stringify({
  name: 'flora',
  description: 'gardening persona',
  port: 8097,
  bind: '0.0.0.0',
  token: 'brg_deadbeef',
  workspace: '/workspace',
  max_turns: 5,
  agents: [{ name: 'julia', url: 'http://bridgey-julia:8092', token: 'brg_abc' }],
  trusted_networks: ['100.64.0.0/10'],
});

describe('parseConfig', () => {
  it('passes a complete config through with agents intact', () => {
    const config = parseConfig(FULL_CONFIG);
    expect(config).not.toBeNull();
    expect(config!.name).toBe('flora');
    expect(config!.agents).toHaveLength(1);
    expect(config!.agents[0].name).toBe('julia');
  });

  it('normalizes a missing agents field to an empty array (crash-loop regression)', () => {
    // Mirrors a minimal config emitted by the container entrypoint: no `agents`.
    // The daemon iterates config.agents on boot, so undefined would crash-loop.
    const minimal = JSON.stringify({ name: 'agent', bind: '0.0.0.0', port: 3000 });
    const config = parseConfig(minimal);
    expect(config).not.toBeNull();
    expect(Array.isArray(config!.agents)).toBe(true);
    expect(config!.agents).toHaveLength(0);
    // The boot-time sync loop must not throw on the normalized config.
    expect(() => {
      for (const _agent of config!.agents) { /* no-op */ }
    }).not.toThrow();
  });

  it('coerces a non-array agents value to an empty array', () => {
    const bad = JSON.stringify({ name: 'agent', agents: 'not-an-array' });
    const config = parseConfig(bad);
    expect(config!.agents).toEqual([]);
  });

  it('returns null on invalid JSON', () => {
    expect(parseConfig('{ not valid json')).toBeNull();
  });

  it('returns null on a non-object payload', () => {
    expect(parseConfig('"just a string"')).toBeNull();
    expect(parseConfig('[1, 2, 3]')).toBeNull();
    expect(parseConfig('null')).toBeNull();
  });
});
