import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { TransportRegistry } from '../transport-registry.js';
import { ChannelPush } from '../channel-push.js';
import { registerTransportRoutes } from '../transport-routes.js';

/**
 * Spin up a tiny Fastify server to act as a mock transport callback target.
 * Returns { url, close, lastRequest }.
 */
async function createMockTransport(opts?: { status?: number }) {
  const status = opts?.status ?? 200;
  const requests: { path: string; body: unknown }[] = [];
  const mock = Fastify({ logger: false });

  mock.post('/callback/reply', async (req, reply) => {
    requests.push({ path: '/callback/reply', body: req.body });
    return reply.code(status).send({ ok: status < 400 });
  });

  mock.post('/callback/react', async (req, reply) => {
    requests.push({ path: '/callback/react', body: req.body });
    return reply.code(status).send({ ok: status < 400 });
  });

  const address = await mock.listen({ port: 0, host: '127.0.0.1' });
  return { url: address, close: () => mock.close(), requests };
}

describe('transport-routes', () => {
  let app: ReturnType<typeof Fastify>;
  let registry: TransportRegistry;
  let channelPush: ChannelPush;

  beforeEach(async () => {
    registry = new TransportRegistry();
    channelPush = new ChannelPush();
    app = Fastify({ logger: false });
    registerTransportRoutes(app, registry, channelPush);
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
  });

  // ── Transport Registration ──────────────────────────────────────────

  describe('POST /transports/register', () => {
    it('registers a valid transport', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/transports/register',
        payload: {
          name: 'discord',
          callback_url: 'http://localhost:9090',
          capabilities: ['reply', 'react'],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({ ok: true, transport_id: 'discord' });
      expect(registry.get('discord')).toBeDefined();
    });

    it('returns 400 for invalid body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/transports/register',
        payload: { name: '' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty('error');
    });

    it('returns 400 for invalid name format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/transports/register',
        payload: {
          name: 'Invalid-Name',
          callback_url: 'http://localhost:9090',
          capabilities: ['reply'],
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /transports/unregister', () => {
    it('unregisters a transport', async () => {
      registry.register({ name: 'discord', callback_url: 'http://localhost:9090', capabilities: ['reply'] });
      const res = await app.inject({
        method: 'POST',
        url: '/transports/unregister',
        payload: { name: 'discord' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(registry.get('discord')).toBeUndefined();
    });

    it('returns 400 for missing name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/transports/unregister',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /transports', () => {
    it('lists registered transports', async () => {
      registry.register({ name: 'discord', callback_url: 'http://localhost:9090', capabilities: ['reply'] });
      registry.register({ name: 'telegram', callback_url: 'http://localhost:9091', capabilities: ['reply', 'react'] });

      const res = await app.inject({ method: 'GET', url: '/transports' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.transports).toHaveLength(2);
      expect(body.transports.map((t: any) => t.name)).toContain('discord');
      expect(body.transports.map((t: any) => t.name)).toContain('telegram');
    });

    it('returns empty list when no transports', async () => {
      const res = await app.inject({ method: 'GET', url: '/transports' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ transports: [] });
    });
  });

  // ── Channel Server ─────────────────────────────────────────────────

  describe('POST /channel/register', () => {
    it('registers a push URL', async () => {
      const mock = await createMockTransport();
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/channel/register',
          payload: { push_url: `${mock.url}/push` },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.ok).toBe(true);
        expect(typeof body.pending_count).toBe('number');
        expect(channelPush.isConnected()).toBe(true);
      } finally {
        await mock.close();
      }
    });

    it('returns 400 for invalid push_url', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/channel/register',
        payload: { push_url: 'not-a-url' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /channel/unregister', () => {
    it('unregisters the channel', async () => {
      channelPush.register('http://localhost:7777/push');
      const res = await app.inject({ method: 'POST', url: '/channel/unregister' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(channelPush.isConnected()).toBe(false);
    });
  });

  // ── Inbound Messages ───────────────────────────────────────────────

  describe('POST /messages/inbound', () => {
    it('queues when no channel server is connected', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/messages/inbound',
        payload: {
          transport: 'discord',
          chat_id: 'discord:12345',
          sender: 'user123',
          content: 'hello bridgey',
          meta: { guild_id: '999' },
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.queued).toBe(true);
      expect(channelPush.pendingCount()).toBe(1);
    });

    it('returns 400 for invalid body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/messages/inbound',
        payload: { content: 'missing fields' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Reply Routing ──────────────────────────────────────────────────

  describe('POST /messages/reply', () => {
    it('routes reply to the correct transport', async () => {
      const mock = await createMockTransport();
      try {
        registry.register({ name: 'discord', callback_url: mock.url, capabilities: ['reply'] });

        const res = await app.inject({
          method: 'POST',
          url: '/messages/reply',
          payload: {
            chat_id: 'discord:12345',
            text: 'here is my reply',
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, delivered: true });
        expect(mock.requests).toHaveLength(1);
        expect(mock.requests[0].path).toBe('/callback/reply');
      } finally {
        await mock.close();
      }
    });

    it('returns 404 for unknown transport', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/messages/reply',
        payload: {
          chat_id: 'unknown:12345',
          text: 'hello',
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 503 for unhealthy transport', async () => {
      registry.register({ name: 'discord', callback_url: 'http://localhost:9090', capabilities: ['reply'] });
      registry.markUnhealthy('discord');

      const res = await app.inject({
        method: 'POST',
        url: '/messages/reply',
        payload: {
          chat_id: 'discord:12345',
          text: 'hello',
        },
      });
      expect(res.statusCode).toBe(503);
    });

    it('returns 502 on transport callback failure', async () => {
      const mock = await createMockTransport({ status: 500 });
      try {
        registry.register({ name: 'discord', callback_url: mock.url, capabilities: ['reply'] });

        const res = await app.inject({
          method: 'POST',
          url: '/messages/reply',
          payload: {
            chat_id: 'discord:12345',
            text: 'hello',
          },
        });
        expect(res.statusCode).toBe(502);
      } finally {
        await mock.close();
      }
    });

    it('returns 400 for invalid body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/messages/reply',
        payload: { text: '' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── React Routing ──────────────────────────────────────────────────

  describe('POST /messages/react', () => {
    it('routes reaction to the correct transport', async () => {
      const mock = await createMockTransport();
      try {
        registry.register({ name: 'discord', callback_url: mock.url, capabilities: ['reply', 'react'] });

        const res = await app.inject({
          method: 'POST',
          url: '/messages/react',
          payload: {
            chat_id: 'discord:12345',
            message_id: 'msg_001',
            emoji: '👍',
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, delivered: true });
        expect(mock.requests).toHaveLength(1);
        expect(mock.requests[0].path).toBe('/callback/react');
      } finally {
        await mock.close();
      }
    });

    it('returns 400 when transport lacks react capability', async () => {
      registry.register({ name: 'discord', callback_url: 'http://localhost:9090', capabilities: ['reply'] });

      const res = await app.inject({
        method: 'POST',
        url: '/messages/react',
        payload: {
          chat_id: 'discord:12345',
          message_id: 'msg_001',
          emoji: '👍',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('does not support reactions');
    });

    it('returns 404 for unknown transport', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/messages/react',
        payload: {
          chat_id: 'unknown:12345',
          message_id: 'msg_001',
          emoji: '👍',
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/messages/react',
        payload: { chat_id: 'discord:123' },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
