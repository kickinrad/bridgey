import { describe, it, expect } from 'vitest';
import { loadConfig, type DiscordConfig } from '../config.js';

describe('loadConfig', () => {
  it('loads valid config from JSON', () => {
    const raw = {
      bots: [{
        name: 'julia',
        token_env: 'DISCORD_BOT_JULIA',
        daemon_url: 'http://bridgey-julia:8092',
        channels: ['kitchen'],
      }],
    };
    const config = loadConfig(raw);
    expect(config.bots).toHaveLength(1);
    expect(config.bots[0].name).toBe('julia');
    expect(config.bots[0].token_env).toBe('DISCORD_BOT_JULIA');
    expect(config.bots[0].daemon_url).toBe('http://bridgey-julia:8092');
    expect(config.bots[0].channels).toEqual(['kitchen']);
  });

  it('loads config with multiple bots', () => {
    const raw = {
      bots: [
        {
          name: 'julia',
          token_env: 'DISCORD_BOT_JULIA',
          daemon_url: 'http://bridgey-julia:8092',
          channels: ['kitchen', 'meal-planning'],
        },
        {
          name: 'mila',
          token_env: 'DISCORD_BOT_MILA',
          daemon_url: 'http://bridgey-mila:8093',
          channels: ['brand-strategy', 'content'],
        },
      ],
    };
    const config = loadConfig(raw);
    expect(config.bots).toHaveLength(2);
    expect(config.bots[1].name).toBe('mila');
  });

  it('rejects config with no bots', () => {
    expect(() => loadConfig({ bots: [] })).toThrow();
  });

  it('rejects config with missing required fields', () => {
    expect(() => loadConfig({ bots: [{ name: 'julia' }] })).toThrow();
  });

  it('rejects bot with empty channels', () => {
    expect(() => loadConfig({
      bots: [{
        name: 'julia',
        token_env: 'DISCORD_BOT_JULIA',
        daemon_url: 'http://localhost:8092',
        channels: [],
      }],
    })).toThrow();
  });

  it('rejects bot with invalid daemon_url', () => {
    expect(() => loadConfig({
      bots: [{
        name: 'julia',
        token_env: 'DISCORD_BOT_JULIA',
        daemon_url: 'not-a-url',
        channels: ['kitchen'],
      }],
    })).toThrow();
  });
});
