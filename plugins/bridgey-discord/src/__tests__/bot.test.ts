import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PersonaBot } from '../types.js';
import type { BotConfig } from '../config.js';
import { DiscordBotManager } from '../bot.js';

// Mock discord.js so the import in bot.ts doesn't pull in the real library
vi.mock('discord.js', () => ({
  Client: vi.fn(),
  Events: { MessageCreate: 'messageCreate', ClientReady: 'ready' },
  GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 3 },
}));

// Mock A2ABridge
vi.mock('../a2a-bridge.js', () => ({
  A2ABridge: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue('bot response'),
    health: vi.fn().mockResolvedValue(true),
  })),
}));

// --- Helpers ---

function createBotConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    name: 'julia',
    token_env: 'DISCORD_BOT_JULIA',
    daemon_url: 'http://localhost:8092',
    channels: ['kitchen', 'meal-planning'],
    ...overrides,
  };
}

function createMockBridge(overrides: Record<string, unknown> = {}) {
  return {
    send: vi.fn().mockResolvedValue('bot response'),
    health: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function createMockMessage(overrides: Record<string, unknown> = {}) {
  const { channel: channelOverride, author: authorOverride, ...rest } = overrides;
  const channelDefaults = {
    name: 'kitchen',
    send: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    isThread: () => false,
    id: 'channel-1',
  };
  const channel = channelOverride
    ? { ...channelDefaults, ...(channelOverride as Record<string, unknown>) }
    : channelDefaults;

  return {
    author: { bot: false, ...(authorOverride as Record<string, unknown> || {}) },
    content: 'test message',
    channel,
    reply: vi.fn().mockResolvedValue(undefined),
    id: 'msg-123',
    ...rest,
  };
}

function createPersonaBot(overrides: Partial<PersonaBot> = {}): PersonaBot {
  return {
    config: createBotConfig(),
    client: {} as PersonaBot['client'],
    bridge: createMockBridge() as unknown as PersonaBot['bridge'],
    contextMap: new Map(),
    ...overrides,
  };
}

/**
 * Access the private handleMessage method for testing.
 * We instantiate DiscordBotManager and grab the method via prototype,
 * binding it to a context that has the right shape.
 */
async function callHandleMessage(bot: PersonaBot, msg: ReturnType<typeof createMockMessage>) {
  // handleMessage is a private instance method on DiscordBotManager.
  // We can call it via the prototype, passing any `this` context — the method
  // only uses bot and msg parameters, not `this`.
  const proto = DiscordBotManager.prototype as unknown as Record<string, Function>;
  return proto.handleMessage.call({}, bot, msg);
}

// --- Tests ---

describe('DiscordBotManager.handleMessage', () => {
  let bot: PersonaBot;

  beforeEach(() => {
    bot = createPersonaBot();
  });

  it('ignores messages from bots', async () => {
    const msg = createMockMessage({ author: { bot: true } });

    await callHandleMessage(bot, msg);

    expect(msg.channel.sendTyping).not.toHaveBeenCalled();
    expect((bot.bridge.send as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('ignores messages in channels without a name property', async () => {
    // Simulate a DM channel that has no `name` property
    const channel = {
      send: vi.fn().mockResolvedValue(undefined),
      sendTyping: vi.fn().mockResolvedValue(undefined),
      isThread: () => false,
      id: 'dm-1',
    };
    // Delete name to simulate channel without name (DMs)
    const msg = createMockMessage({ channel });
    delete (msg.channel as Record<string, unknown>).name;

    await callHandleMessage(bot, msg);

    expect(channel.sendTyping).not.toHaveBeenCalled();
    expect((bot.bridge.send as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('ignores messages in non-matching channels', async () => {
    const msg = createMockMessage({
      channel: {
        name: 'off-topic',
        send: vi.fn().mockResolvedValue(undefined),
        sendTyping: vi.fn().mockResolvedValue(undefined),
        isThread: () => false,
        id: 'channel-2',
      },
    });

    await callHandleMessage(bot, msg);

    expect(msg.channel.sendTyping).not.toHaveBeenCalled();
    expect((bot.bridge.send as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('routes matching channel messages to A2A bridge', async () => {
    const msg = createMockMessage({ content: 'What should I cook?' });

    await callHandleMessage(bot, msg);

    expect((bot.bridge.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'What should I cook?',
      expect.stringContaining('discord-'),
    );
  });

  it('sends typing indicator before calling bridge', async () => {
    const callOrder: string[] = [];
    const bridge = createMockBridge({
      send: vi.fn().mockImplementation(async () => {
        callOrder.push('bridge.send');
        return 'response';
      }),
    });
    const msg = createMockMessage({
      channel: {
        name: 'kitchen',
        sendTyping: vi.fn().mockImplementation(async () => {
          callOrder.push('sendTyping');
        }),
        send: vi.fn().mockResolvedValue(undefined),
        isThread: () => false,
        id: 'channel-1',
      },
    });
    bot = createPersonaBot({ bridge: bridge as unknown as PersonaBot['bridge'] });

    await callHandleMessage(bot, msg);

    expect(callOrder).toEqual(['sendTyping', 'bridge.send']);
  });

  it('splits responses > 1900 chars into chunks', async () => {
    const longResponse = 'A'.repeat(3800); // Should split into 2 chunks
    const bridge = createMockBridge({
      send: vi.fn().mockResolvedValue(longResponse),
    });
    bot = createPersonaBot({ bridge: bridge as unknown as PersonaBot['bridge'] });
    const msg = createMockMessage();

    await callHandleMessage(bot, msg);

    expect(msg.channel.send).toHaveBeenCalledTimes(2);
    // First chunk is 1900 chars, second is 1900 chars
    expect((msg.channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(1900);
    expect((msg.channel.send as ReturnType<typeof vi.fn>).mock.calls[1][0]).toHaveLength(1900);
  });

  it('maps thread IDs to context IDs', async () => {
    const msg = createMockMessage({
      channel: {
        name: 'kitchen',
        send: vi.fn().mockResolvedValue(undefined),
        sendTyping: vi.fn().mockResolvedValue(undefined),
        isThread: () => true,
        id: 'thread-999',
      },
    });

    await callHandleMessage(bot, msg);

    // When in a thread, the threadId is channel.id
    expect(bot.contextMap.get('thread-999')).toBe('discord-thread-999');
    expect((bot.bridge.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'test message',
      'discord-thread-999',
    );
  });

  it('reuses existing context ID for same thread', async () => {
    bot.contextMap.set('thread-999', 'discord-thread-999');
    const msg = createMockMessage({
      channel: {
        name: 'kitchen',
        send: vi.fn().mockResolvedValue(undefined),
        sendTyping: vi.fn().mockResolvedValue(undefined),
        isThread: () => true,
        id: 'thread-999',
      },
    });

    await callHandleMessage(bot, msg);

    expect((bot.bridge.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'test message',
      'discord-thread-999',
    );
  });

  it('uses message ID as context key when not in a thread', async () => {
    const msg = createMockMessage({ id: 'msg-456' });

    await callHandleMessage(bot, msg);

    expect(bot.contextMap.get('msg-456')).toBe('discord-msg-456');
    expect((bot.bridge.send as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'test message',
      'discord-msg-456',
    );
  });

  it('sends error message to channel when bridge fails', async () => {
    const bridge = createMockBridge({
      send: vi.fn().mockRejectedValue(new Error('Connection refused')),
    });
    bot = createPersonaBot({ bridge: bridge as unknown as PersonaBot['bridge'] });
    const msg = createMockMessage();

    await callHandleMessage(bot, msg);

    expect(msg.channel.send).toHaveBeenCalledWith(
      "Sorry, I'm having trouble right now. (Connection refused)",
    );
  });

  it('replies in thread when message is in a thread', async () => {
    const msg = createMockMessage({
      channel: {
        name: 'kitchen',
        send: vi.fn().mockResolvedValue(undefined),
        sendTyping: vi.fn().mockResolvedValue(undefined),
        isThread: () => true,
        id: 'thread-111',
      },
    });

    await callHandleMessage(bot, msg);

    // In a thread, bot uses msg.reply() instead of channel.send()
    expect(msg.reply).toHaveBeenCalledWith('bot response');
    expect(msg.channel.send).not.toHaveBeenCalled();
  });

  it('sends to channel (not reply) when not in a thread', async () => {
    const msg = createMockMessage();

    await callHandleMessage(bot, msg);

    expect(msg.channel.send).toHaveBeenCalledWith('bot response');
    expect(msg.reply).not.toHaveBeenCalled();
  });

  it('sends "No response" when bridge returns empty string', async () => {
    const bridge = createMockBridge({
      send: vi.fn().mockResolvedValue(''),
    });
    bot = createPersonaBot({ bridge: bridge as unknown as PersonaBot['bridge'] });
    const msg = createMockMessage();

    await callHandleMessage(bot, msg);

    expect(msg.channel.send).toHaveBeenCalledWith('No response');
  });
});
