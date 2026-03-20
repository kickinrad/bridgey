import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TransportRegistry } from './transport-registry.js';
import type { ChannelPush } from './channel-push.js';
import {
  TransportRegisterSchema,
  TransportUnregisterSchema,
  ChannelRegisterSchema,
  InboundMessageSchema,
  OutboundReplySchema,
  parseTransportFromChatId,
} from './transport-types.js';

export const OutboundReactSchema = z.object({
  chat_id: z.string().min(1),
  message_id: z.string().min(1),
  emoji: z.string().min(1),
});

/**
 * Register transport management, channel server, and message routes.
 */
export function registerTransportRoutes(
  app: FastifyInstance,
  registry: TransportRegistry,
  channelPush: ChannelPush,
): void {
  // ── Transport Management ────────────────────────────────────────────

  app.post('/transports/register', async (req, reply) => {
    const parsed = TransportRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }
    registry.register(parsed.data);
    return reply.send({ ok: true, transport_id: parsed.data.name });
  });

  app.post('/transports/unregister', async (req, reply) => {
    const parsed = TransportUnregisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }
    registry.unregister(parsed.data.name);
    return reply.send({ ok: true });
  });

  app.get('/transports', async (_req, reply) => {
    return reply.send({ transports: registry.list() });
  });

  // ── Channel Server ─────────────────────────────────────────────────

  app.post('/channel/register', async (req, reply) => {
    const parsed = ChannelRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }
    channelPush.register(parsed.data.push_url);
    const pushed = await channelPush.pushPending();
    return reply.send({ ok: true, pending_count: channelPush.pendingCount() });
  });

  app.post('/channel/unregister', async (_req, reply) => {
    channelPush.unregister();
    return reply.send({ ok: true });
  });

  // ── Messages ────────────────────────────────────────────────────────

  app.post('/messages/inbound', async (req, reply) => {
    const parsed = InboundMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const { transport, chat_id, sender, content, meta, attachments } = parsed.data;

    // Build channel meta: merge transport-specific fields into meta
    const channelMeta: Record<string, string> = {
      ...meta,
      transport,
      chat_id,
      sender,
    };

    const pushed = await channelPush.push({ content, meta: channelMeta });
    return reply.send({ ok: true, queued: !pushed });
  });

  app.post('/messages/reply', async (req, reply) => {
    const parsed = OutboundReplySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const { chat_id, text, reply_to, files } = parsed.data;
    const transport = registry.resolveFromChatId(chat_id);

    if (!transport) {
      return reply.code(404).send({ error: `No transport found for chat_id "${chat_id}"` });
    }

    if (!transport.healthy) {
      return reply.code(503).send({ error: `Transport "${transport.name}" is unhealthy` });
    }

    try {
      const res = await fetch(`${transport.callback_url}/callback/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text, reply_to, files }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return reply.code(502).send({ error: `Transport returned ${res.status}` });
      }

      return reply.send({ ok: true, delivered: true });
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to deliver reply',
      });
    }
  });

  app.post('/messages/react', async (req, reply) => {
    const parsed = OutboundReactSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const { chat_id, message_id, emoji } = parsed.data;
    const transport = registry.resolveFromChatId(chat_id);

    if (!transport) {
      return reply.code(404).send({ error: `No transport found for chat_id "${chat_id}"` });
    }

    if (!transport.capabilities.includes('react')) {
      return reply.code(400).send({ error: `Transport "${transport.name}" does not support reactions` });
    }

    if (!transport.healthy) {
      return reply.code(503).send({ error: `Transport "${transport.name}" is unhealthy` });
    }

    try {
      const res = await fetch(`${transport.callback_url}/callback/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, message_id, emoji }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return reply.code(502).send({ error: `Transport returned ${res.status}` });
      }

      return reply.send({ ok: true, delivered: true });
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to deliver reaction',
      });
    }
  });
}
