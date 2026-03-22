import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Fastify from 'fastify';
import { Store } from '../store.js';
import { TransportRegistry } from '../transport-registry.js';
import { ChannelPush } from '../channel-push.js';
import { registerTransportRoutes } from '../transport-routes.js';
import { startChannelCapture } from '#test-utils/channel-capture';
import type { ChannelCapture } from '#test-utils/channel-capture';

vi.mock('../executor.js', () => ({
  executePrompt: vi.fn().mockResolvedValue('Mock response from claude'),
}));

const { a2aRoutes } = await import('../a2a-server.js');

describe('e2e: channel push integration', () => {
  let app: ReturnType<typeof Fastify>;
  let dir: string;
  let channelPush: ChannelPush;
  let capture: ChannelCapture;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bridgey-channel-push-'));
    const store = new Store(dir);
    const registry = new TransportRegistry();
    channelPush = new ChannelPush();

    app = Fastify({ logger: false });
    a2aRoutes(app, {
      name: 'channel-test',
      description: 'Channel push test',
      port: 0,
      bind: 'localhost',
      token: 'brg_channeltest',
      workspace: '/tmp',
      max_turns: 1,
      agents: [],
    }, store);
    registerTransportRoutes(app, registry, channelPush);

    await app.listen({ port: 0, host: '127.0.0.1' });
    capture = await startChannelCapture();
  });

  afterAll(async () => {
    await capture?.close();
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('pushes inbound message to channel capture server', async () => {
    // Register the capture server as the channel push target
    const regRes = await app.inject({
      method: 'POST',
      url: '/channel/register',
      payload: { push_url: capture.url },
    });
    expect(regRes.statusCode).toBe(200);

    // Set up the wait before sending
    const waitPromise = capture.waitForMessage(3000);

    // Send an inbound message
    const inboundRes = await app.inject({
      method: 'POST',
      url: '/messages/inbound',
      payload: {
        transport: 'discord',
        chat_id: 'discord:12345',
        sender: 'testuser',
        content: 'hello from discord',
        meta: { guild_id: '999' },
      },
    });
    expect(inboundRes.statusCode).toBe(200);
    expect(inboundRes.json().queued).toBe(false);

    // Verify the capture server received it
    const msg = await waitPromise;
    expect(msg.content).toBe('hello from discord');
    expect(msg.meta.transport).toBe('discord');
    expect(msg.meta.chat_id).toBe('discord:12345');
    expect(msg.meta.sender).toBe('testuser');
    expect(msg.meta.guild_id).toBe('999');
  });

  it('meta keys use underscores only (no hyphens)', async () => {
    const waitPromise = capture.waitForMessage(3000);

    await app.inject({
      method: 'POST',
      url: '/messages/inbound',
      payload: {
        transport: 'test',
        chat_id: 'test:100',
        sender: 'user1',
        content: 'meta test',
        meta: { some_key: 'value', another_key: 'v2' },
      },
    });

    const msg = await waitPromise;
    for (const key of Object.keys(msg.meta)) {
      expect(key).toMatch(/^[a-zA-Z0-9_]+$/);
    }
  });

  it('queues messages when no channel is registered', async () => {
    // Unregister channel first
    await app.inject({ method: 'POST', url: '/channel/unregister' });
    expect(channelPush.isConnected()).toBe(false);

    // Send 3 messages — should queue
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/messages/inbound',
        payload: {
          transport: 'test',
          chat_id: 'test:queue',
          sender: 'queuer',
          content: `queued message ${i}`,
          meta: {},
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().queued).toBe(true);
    }

    expect(channelPush.pendingCount()).toBe(3);
    expect(capture.messages.length).toBe(2); // Only the 2 from previous tests
  });

  it('drains queued messages on channel registration', async () => {
    const beforeCount = capture.messages.length;

    // Re-register — should drain pending
    const regRes = await app.inject({
      method: 'POST',
      url: '/channel/register',
      payload: { push_url: capture.url },
    });
    expect(regRes.statusCode).toBe(200);

    // Wait for drain to complete
    await new Promise((r) => setTimeout(r, 500));

    // All 3 queued messages should have been pushed
    expect(capture.messages.length).toBe(beforeCount + 3);
    expect(channelPush.pendingCount()).toBe(0);
  });

  it('caps queue at 100 messages', async () => {
    // Unregister channel
    await app.inject({ method: 'POST', url: '/channel/unregister' });

    // Send 110 messages
    for (let i = 0; i < 110; i++) {
      await app.inject({
        method: 'POST',
        url: '/messages/inbound',
        payload: {
          transport: 'test',
          chat_id: 'test:overflow',
          sender: 'bulk',
          content: `msg ${i}`,
          meta: {},
        },
      });
    }

    // Only 100 should be retained
    expect(channelPush.pendingCount()).toBe(100);

    // Re-register to drain for cleanup
    await app.inject({
      method: 'POST',
      url: '/channel/register',
      payload: { push_url: capture.url },
    });
    await new Promise((r) => setTimeout(r, 1000));
  });
});
