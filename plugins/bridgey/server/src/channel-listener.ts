import { createServer } from 'node:http';

export interface ChannelMessage {
  content: string;
  meta: Record<string, string>;
}

export interface ChannelListenerOptions {
  onMessage: (message: ChannelMessage) => void;
}

export interface ChannelListenerHandle {
  port: number;
  close: () => void;
}

/**
 * Starts a local HTTP server on a random port that receives push messages
 * from the daemon and forwards them as MCP channel notifications.
 */
export function startChannelListener(
  options: ChannelListenerOptions,
): Promise<ChannelListenerHandle> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);

      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        options.onMessage(body);
        res.writeHead(200).end('ok');
      } catch {
        res.writeHead(400).end('bad request');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind channel listener'));
        return;
      }
      resolve({ port: addr.port, close: () => server.close() });
    });
  });
}
