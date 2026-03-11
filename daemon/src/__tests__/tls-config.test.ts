import { describe, it, expect } from 'vitest';
import type { BridgeyConfig } from '../types.js';

describe('TLS config', () => {
  it('TLS fields are optional on BridgeyConfig', () => {
    const config: BridgeyConfig = {
      name: 'test',
      description: 'test',
      port: 8092,
      bind: 'localhost',
      token: 'brg_test',
      workspace: '/tmp',
      max_turns: 1,
      agents: [],
    };
    expect(config.tls).toBeUndefined();
  });

  it('TLS fields accept cert paths', () => {
    const config: BridgeyConfig = {
      name: 'test',
      description: 'test',
      port: 8092,
      bind: 'localhost',
      token: 'brg_test',
      workspace: '/tmp',
      max_turns: 1,
      agents: [],
      tls: {
        cert: '/path/to/cert.pem',
        key: '/path/to/key.pem',
        ca: '/path/to/ca.pem',
      },
    };
    expect(config.tls?.cert).toBe('/path/to/cert.pem');
    expect(config.tls?.ca).toBe('/path/to/ca.pem');
  });
});
