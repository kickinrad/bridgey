import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

export interface ChannelMessage {
  content: string;
  meta: Record<string, unknown>;
  receivedAt: number;
}

export interface ChannelCapture {
  url: string;
  port: number;
  messages: ChannelMessage[];
  waitForMessage: (timeoutMs?: number) => Promise<ChannelMessage>;
  close: () => Promise<void>;
}

/**
 * Start a tiny HTTP server that captures channel push messages.
 * The daemon POSTs { content, meta } to the channel listener URL.
 * Use waitForMessage() for promise-based waiting (no polling).
 */
export async function startChannelCapture(): Promise<ChannelCapture> {
  const messages: ChannelMessage[] = [];
  const waiters: Array<(msg: ChannelMessage) => void> = [];

  const app: FastifyInstance = Fastify({ logger: false });

  app.post('/', async (request, reply) => {
    const body = request.body as { content?: string; meta?: Record<string, unknown> };
    const msg: ChannelMessage = {
      content: body.content ?? '',
      meta: body.meta ?? {},
      receivedAt: Date.now(),
    };
    messages.push(msg);

    // Resolve any pending waiters
    const waiter = waiters.shift();
    if (waiter) waiter(msg);

    return reply.send({ ok: true });
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  function waitForMessage(timeoutMs = 5000): Promise<ChannelMessage> {
    // If there's already an unconsumed message, return it
    const existing = messages[messages.length - 1];
    if (existing && waiters.length === 0 && messages.length > (waiters.length)) {
      // Only return immediately if this is a new message since last wait
    }

    return new Promise<ChannelMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = waiters.indexOf(resolve);
        if (idx !== -1) waiters.splice(idx, 1);
        reject(new Error(`No channel message received within ${timeoutMs}ms`));
      }, timeoutMs);

      const wrappedResolve = (msg: ChannelMessage) => {
        clearTimeout(timeout);
        resolve(msg);
      };

      waiters.push(wrappedResolve);
    });
  }

  async function close(): Promise<void> {
    await app.close();
  }

  return { url, port, messages, waitForMessage, close };
}
