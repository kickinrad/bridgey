import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TransportRegistry } from './transport-registry.js';
import type { ChannelPush } from './channel-push.js';
import { executePrompt, chatIdToSessionId } from './executor.js';
import type { BridgeyConfig } from './types.js';
import {
  TransportRegisterSchema,
  TransportUnregisterSchema,
  ChannelRegisterSchema,
  ChannelUnregisterSchema,
  InboundMessageSchema,
  OutboundReplySchema,
  OutboundReactSchema,
  OutboundEditSchema,
  FetchMessagesSchema,
  DownloadAttachmentSchema,
  PermissionRequestSchema,
  PermissionResponseSchema,
  parseTransportFromChatId,
} from './transport-types.js';

/**
 * Register transport management, channel server, and message routes.
 */
export function registerTransportRoutes(
  app: FastifyInstance,
  registry: TransportRegistry,
  channelPush: ChannelPush,
  config?: BridgeyConfig,
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
    channelPush.register(parsed.data.agent_name, parsed.data.push_url);
    await channelPush.pushPending();
    return reply.send({ ok: true, pending_count: channelPush.pendingCount() });
  });

  app.post('/channel/unregister', async (req, reply) => {
    const parsed = ChannelUnregisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }
    channelPush.unregister(parsed.data.agent_name);
    return reply.send({ ok: true });
  });

  app.get('/channel/sessions', async (_req, reply) => {
    return reply.send({ sessions: channelPush.list() });
  });

  // ── Permission Relay ────────────────────────────────────────────────

  app.post('/channel/permission-request', async (req, reply) => {
    const parsed = PermissionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const { request_id, tool_name, description, input_preview } = parsed.data;

    // Fan out to all transports with 'permission' capability
    const transports = registry.list().filter(
      (t) => t.healthy && t.capabilities.includes('permission'),
    );

    if (transports.length === 0) {
      return reply.code(404).send({ error: 'No transports with permission capability registered' });
    }

    const results = await Promise.allSettled(
      transports.map((t) =>
        fetch(`${t.callback_url}/callback/permission-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id, tool_name, description, input_preview }),
          signal: AbortSignal.timeout(10_000),
        }),
      ),
    );

    const delivered = results.filter((r) => r.status === 'fulfilled').length;
    return reply.send({ ok: true, delivered, total: transports.length });
  });

  app.post('/messages/permission-response', async (req, reply) => {
    const parsed = PermissionResponseSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const { request_id, behavior } = parsed.data;

    const pushed = await channelPush.push({
      content: `[Permission ${behavior}: ${request_id}]`,
      meta: {
        permission_response: 'true',
        request_id,
        behavior,
      },
    });

    return reply.send({ ok: true, delivered: pushed });
  });

  // ── Messages ────────────────────────────────────────────────────────

  // ── Pairing ───────────────────────────────────────────────────────

  app.post('/pairing/approve', async (req, reply) => {
    const schema = z.object({
      chat_id: z.string().min(1),
      user_id: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const { chat_id, user_id } = parsed.data;
    const transport = registry.resolveFromChatId(chat_id);

    if (!transport) {
      return reply.code(404).send({ error: `No transport found for chat_id "${chat_id}"` });
    }

    try {
      const res = await fetch(`${transport.callback_url}/callback/pairing-approved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return reply.code(502).send({ error: `Transport returned ${res.status}` });
      }

      return reply.send({ ok: true, user_id });
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to deliver pairing approval',
      });
    }
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

    // If Channel Server is connected, push through it
    if (channelPush.isConnected()) {
      const pushed = await channelPush.push({ content, meta: channelMeta });
      return reply.send({ ok: true, queued: !pushed });
    }

    // Fallback: execute via claude -p and reply through the transport
    if (!config?.workspace) {
      channelPush.enqueue({ content, meta: channelMeta });
      return reply.send({ ok: true, queued: true });
    }

    const transportEntry = registry.resolveFromChatId(chat_id);
    if (!transportEntry) {
      channelPush.enqueue({ content, meta: channelMeta });
      return reply.send({ ok: true, queued: true });
    }

    // Respond immediately, execute async
    reply.send({ ok: true, queued: false, mode: 'executor' });

    // Fire-and-forget: execute and reply through transport callback
    const prompt = `[Message from ${sender} via ${transport}]\n${content}`;
    const sessionId = chatIdToSessionId(chat_id);
    executePrompt(prompt, config.workspace, config.max_turns ?? 5, sessionId)
      .then(async (response) => {
        try {
          await fetch(`${transportEntry.callback_url}/callback/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id, text: response }),
            signal: AbortSignal.timeout(10_000),
          });
        } catch (err) {
          console.error(`Failed to deliver executor reply to ${transport}:`, err);
        }
      })
      .catch((err) => {
        console.error(`Executor failed for inbound from ${sender}:`, err);
      });
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

      const data = await res.json() as Record<string, unknown>;
      return reply.send({ ok: true, delivered: true, ...data });
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

  app.post('/messages/edit', async (req, reply) => {
    const parsed = OutboundEditSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const { chat_id, message_id, text } = parsed.data;
    const transport = registry.resolveFromChatId(chat_id);

    if (!transport) {
      return reply.code(404).send({ error: `No transport found for chat_id "${chat_id}"` });
    }

    if (!transport.capabilities.includes('edit_message')) {
      return reply.code(400).send({ error: `Transport "${transport.name}" does not support message editing` });
    }

    if (!transport.healthy) {
      return reply.code(503).send({ error: `Transport "${transport.name}" is unhealthy` });
    }

    try {
      const res = await fetch(`${transport.callback_url}/callback/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, message_id, text }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return reply.code(502).send({ error: `Transport returned ${res.status}` });
      }

      return reply.send({ ok: true, delivered: true });
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to deliver edit',
      });
    }
  });

  app.post('/messages/fetch', async (req, reply) => {
    const parsed = FetchMessagesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const { chat_id, limit } = parsed.data;
    const transport = registry.resolveFromChatId(chat_id);

    if (!transport) {
      return reply.code(404).send({ error: `No transport found for chat_id "${chat_id}"` });
    }

    if (!transport.capabilities.includes('fetch_messages')) {
      return reply.code(400).send({ error: `Transport "${transport.name}" does not support fetching messages` });
    }

    if (!transport.healthy) {
      return reply.code(503).send({ error: `Transport "${transport.name}" is unhealthy` });
    }

    try {
      const res = await fetch(`${transport.callback_url}/callback/fetch-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, limit }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return reply.code(502).send({ error: `Transport returned ${res.status}` });
      }

      const data = await res.json();
      return reply.send(data);
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to fetch messages',
      });
    }
  });

  app.post('/messages/download-attachment', async (req, reply) => {
    const parsed = DownloadAttachmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const { chat_id, message_id } = parsed.data;
    const transport = registry.resolveFromChatId(chat_id);

    if (!transport) {
      return reply.code(404).send({ error: `No transport found for chat_id "${chat_id}"` });
    }

    if (!transport.capabilities.includes('download_attachment')) {
      return reply.code(400).send({ error: `Transport "${transport.name}" does not support attachment downloads` });
    }

    if (!transport.healthy) {
      return reply.code(503).send({ error: `Transport "${transport.name}" is unhealthy` });
    }

    try {
      const res = await fetch(`${transport.callback_url}/callback/download-attachment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, message_id }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        return reply.code(502).send({ error: `Transport returned ${res.status}` });
      }

      const data = await res.json();
      return reply.send(data);
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : 'Failed to download attachment',
      });
    }
  });
}
