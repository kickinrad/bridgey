import { describe, it, expect, afterEach } from 'vitest';
import { resolveAgentName } from '../config.js';

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

  it('falls back to config name when env not set', () => {
    const result = resolveAgentName({ name: 'my-agent', agents: [] });
    expect(result).toBe('my-agent');
  });

  it('falls back to claude-code when CLAUDE_PLUGIN_ROOT is set', () => {
    process.env.CLAUDE_PLUGIN_ROOT = '/some/path';
    const result = resolveAgentName({ agents: [] });
    expect(result).toBe('claude-code');
  });

  it('defaults to claude-desktop when nothing else matches', () => {
    const result = resolveAgentName(null);
    expect(result).toBe('claude-desktop');
  });

  it('env var takes priority over everything', () => {
    process.env.BRIDGEY_AGENT_NAME = 'custom';
    process.env.CLAUDE_PLUGIN_ROOT = '/some/path';
    const result = resolveAgentName({ name: 'config-name', agents: [] });
    expect(result).toBe('custom');
  });
});
