import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { resolveAgentName, resolveToken } from '../config.js';

describe('resolveAgentName', () => {
  afterEach(() => {
    delete process.env.BRIDGEY_AGENT_NAME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
  });

  it('uses BRIDGEY_AGENT_NAME env var when set', () => {
    process.env.BRIDGEY_AGENT_NAME = 'claude-ai';
    const result = resolveAgentName({ name: 'config-name', agents: [] });
    expect(result).toBe('claude-ai');
  });

  it('auto-derives from cwd basename + pid when env not set', () => {
    const result = resolveAgentName({ name: 'config-host', agents: [] });
    const expected = `${path.basename(process.cwd())}-${process.pid}`;
    expect(result).toBe(expected);
  });

  it('ignores config.name for agent identity (host field is separate concept)', () => {
    const result = resolveAgentName({ name: 'Luna', agents: [] });
    expect(result).not.toBe('Luna');
  });

  it('produces a valid identifier shape: [letter][alnum/_/-]*-<pid>', () => {
    const result = resolveAgentName(null);
    expect(result).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*-\d+$/);
  });

  it('env var takes priority over everything', () => {
    process.env.BRIDGEY_AGENT_NAME = 'custom';
    process.env.CLAUDE_PLUGIN_ROOT = '/some/path';
    const result = resolveAgentName({ name: 'config-name', agents: [] });
    expect(result).toBe('custom');
  });
});

describe('resolveToken', () => {
  afterEach(() => {
    delete process.env.TEST_TOKEN;
  });

  it('resolves $ENV_VAR tokens', () => {
    process.env.TEST_TOKEN = 'secret123';
    expect(resolveToken('$TEST_TOKEN')).toBe('secret123');
  });

  it('returns literal tokens unchanged', () => {
    expect(resolveToken('brg_abc123')).toBe('brg_abc123');
  });

  it('returns undefined for undefined input', () => {
    expect(resolveToken(undefined)).toBeUndefined();
  });

  it('throws when env var is not set', () => {
    expect(() => resolveToken('$NONEXISTENT_VAR')).toThrow('Token env var $NONEXISTENT_VAR is not set');
  });
});
