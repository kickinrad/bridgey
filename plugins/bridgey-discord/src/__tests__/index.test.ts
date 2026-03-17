import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mocks (accessible inside vi.mock factories) ---

const { mockStart, mockStop } = vi.hoisted(() => ({
  mockStart: vi.fn().mockResolvedValue(undefined),
  mockStop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('discord.js', () => ({
  Client: vi.fn(),
  Events: { MessageCreate: 'messageCreate', ClientReady: 'ready' },
  GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 3 },
}));

vi.mock('../a2a-bridge.js', () => ({
  A2ABridge: vi.fn(),
}));

vi.mock('../bot.js', () => ({
  DiscordBotManager: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.start = mockStart;
    this.stop = mockStop;
  }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

vi.mock('../config.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

import { readFileSync } from 'fs';
import { loadConfig } from '../config.js';
import { DiscordBotManager } from '../bot.js';

const mockedReadFileSync = vi.mocked(readFileSync);
const mockedLoadConfig = vi.mocked(loadConfig);

describe('Discord index.ts entry point', () => {
  const originalEnv = { ...process.env };
  let sigTermHandlers: Array<(...args: unknown[]) => void>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sigTermHandlers = [];

    // Re-set mockImplementation after clearAllMocks wipes it
    vi.mocked(DiscordBotManager).mockImplementation(function (this: Record<string, unknown>) {
      this.start = mockStart;
      this.stop = mockStop;
    } as unknown as (...args: unknown[]) => InstanceType<typeof DiscordBotManager>);
    mockStart.mockResolvedValue(undefined);
    mockStop.mockResolvedValue(undefined);

    // Capture SIGTERM handlers registered during module load
    vi.spyOn(process, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'SIGTERM') {
        sigTermHandlers.push(handler);
      }
      return process;
    });

    // Default: happy-path mocks
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ bots: [{ name: 'julia', token_env: 'DISCORD_BOT_JULIA', daemon_url: 'http://localhost:8092', channels: ['kitchen'] }] }),
    );
    mockedLoadConfig.mockReturnValue({
      bots: [{ name: 'julia', token_env: 'DISCORD_BOT_JULIA', daemon_url: 'http://localhost:8092', channels: ['kitchen'] }],
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('throws when DISCORD_CONFIG_PATH points to a missing file', async () => {
    process.env.DISCORD_CONFIG_PATH = '/tmp/nonexistent-bridgey-test-config.json';
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    await expect(async () => {
      await import('../index.js');
    }).rejects.toThrow('ENOENT');
  });

  it('throws when config file contains invalid JSON', async () => {
    process.env.DISCORD_CONFIG_PATH = '/tmp/bad-config.json';
    mockedReadFileSync.mockReturnValue('not valid json {{{');

    await expect(async () => {
      await import('../index.js');
    }).rejects.toThrow();
  });

  it('registers a SIGTERM handler that calls manager.stop()', async () => {
    process.env.DISCORD_CONFIG_PATH = '/tmp/test-config.json';

    await import('../index.js');

    expect(sigTermHandlers.length).toBeGreaterThanOrEqual(1);

    // Stub process.exit to prevent actual exit
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await sigTermHandlers[0]();

    expect(mockStop).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('creates DiscordBotManager with parsed config bots', async () => {
    process.env.DISCORD_CONFIG_PATH = '/tmp/test-config.json';

    await import('../index.js');

    expect(DiscordBotManager).toHaveBeenCalledWith(
      [{ name: 'julia', token_env: 'DISCORD_BOT_JULIA', daemon_url: 'http://localhost:8092', channels: ['kitchen'] }],
      expect.any(Function),
    );
    expect(mockStart).toHaveBeenCalledOnce();
  });
});
