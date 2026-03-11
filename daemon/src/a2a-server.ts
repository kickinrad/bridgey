import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import type { BridgeyConfig, A2ARequest, A2AResponse } from './types.js';
import { validateToken, isLocalAgent } from './auth.js';
import { generateAgentCard } from './agent-card.js';
import { executePrompt } from './executor.js';
import { sendA2AMessage } from './a2a-client.js';
import { saveMessage, getMessages, getAgents, saveAgent } from './db.js';
import { listLocal } from './registry.js';

// Simple in-memory rate limiter: IP → { count, resetAt }
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + 60_000 };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;
  return entry.count <= 10;
}

// Periodic cleanup of stale rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now >= entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, 60_000).unref();

function jsonRpcError(id: string | number, code: number, message: string): A2AResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function jsonRpcResult(id: string | number, result: unknown): A2AResponse {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Register all A2A and management routes on the Fastify instance.
 */
export function a2aRoutes(
  fastify: FastifyInstance,
  config: BridgeyConfig,
): void {
  const agentCard = generateAgentCard(config);

  // Set request timeout for non-long-running routes (30s)
  // /send and POST / can be long-running (claude -p takes up to 5 min)
  fastify.addHook('onRequest', async (req, reply) => {
    const isLongRunning = req.method === 'POST' && (req.url === '/send' || req.url === '/');
    if (!isLongRunning) {
      reply.raw.setTimeout(30_000, () => {
        reply.code(504).send({ error: 'Gateway timeout' });
      });
    }
  });

  // Agent Card discovery — no auth required
  fastify.get('/.well-known/agent-card.json', async (_req, reply) => {
    return reply.type('application/json').send(agentCard);
  });

  // Health check
  fastify.get('/health', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      name: config.name,
      uptime: process.uptime(),
    });
  });

  // List all known agents (DB + local registry)
  fastify.get('/agents', async (req, reply) => {
    if (!validateToken(req, config) && !isLocalAgent(req)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const dbAgents = getAgents();
    const localAgents = listLocal();

    // Merge: local agents that aren't already in DB
    const dbNames = new Set(dbAgents.map((a) => a.name));
    const merged = [
      ...dbAgents.map((a) => ({
        name: a.name,
        url: a.url,
        status: a.status,
        last_seen: a.last_seen,
        source: 'remote' as const,
      })),
      ...localAgents
        .filter((a) => !dbNames.has(a.name))
        .map((a) => ({
          name: a.name,
          url: a.url,
          status: 'local' as const,
          last_seen: null as string | null,
          source: 'local' as const,
        })),
    ];

    return reply.send(merged);
  });

  // Recent messages
  fastify.get('/messages', async (req, reply) => {
    if (!validateToken(req, config) && !isLocalAgent(req)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const query = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(query.limit || '20', 10) || 20, 1), 100);

    return reply.send(getMessages(limit));
  });

  // Internal send endpoint (used by MCP server)
  fastify.post('/send', async (req, reply) => {
    if (!validateToken(req, config) && !isLocalAgent(req)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = req.body as { agent?: string; message?: string; context_id?: string } | null;

    if (!body || !body.agent || !body.message) {
      return reply.code(400).send({ error: 'Missing required fields: agent, message' });
    }

    const { agent: agentName, message, context_id } = body;

    // Look up agent: check DB first, then config, then local registry
    let agentUrl: string | undefined;
    let agentToken = '';

    // Check DB
    const dbAgents = getAgents();
    const dbAgent = dbAgents.find((a) => a.name === agentName);
    if (dbAgent) {
      agentUrl = dbAgent.url;
      agentToken = dbAgent.token || '';
    }

    // Check config
    if (!agentUrl) {
      const configAgent = config.agents.find((a) => a.name === agentName);
      if (configAgent) {
        agentUrl = configAgent.url;
        agentToken = configAgent.token;
      }
    }

    // Check local registry
    if (!agentUrl) {
      const localAgents = listLocal();
      const localAgent = localAgents.find((a) => a.name === agentName);
      if (localAgent) {
        agentUrl = localAgent.url;
        agentToken = ''; // Local agents don't need tokens
      }
    }

    if (!agentUrl) {
      return reply.code(404).send({ error: `Agent "${agentName}" not found` });
    }

    const response = await sendA2AMessage(agentUrl, agentToken, message, context_id || undefined);
    saveMessage('outbound', agentName, message, response, context_id || null);

    return reply.send({ response });
  });

  // A2A JSON-RPC endpoint
  fastify.post('/', async (req, reply) => {
    // Auth check: skip for local agents
    if (!isLocalAgent(req) && !validateToken(req, config)) {
      return reply.code(401).send(jsonRpcError('0', -32000, 'Unauthorized'));
    }

    // Rate limit
    if (!checkRateLimit(req.ip)) {
      return reply.code(429).send(jsonRpcError('0', -32000, 'Rate limit exceeded (10 req/min)'));
    }

    const body = req.body as A2ARequest | null;

    if (!body || body.jsonrpc !== '2.0' || !body.method || !body.id) {
      return reply.code(400).send(jsonRpcError('0', -32600, 'Invalid JSON-RPC request'));
    }

    const { id, method, params } = body;

    switch (method) {
      case 'message/send': {
        // Extract message text
        const parts = (params as any)?.message?.parts;
        if (!Array.isArray(parts) || !parts[0]?.text) {
          return reply.send(jsonRpcError(id, -32602, 'Invalid params: missing message.parts[0].text'));
        }

        const messageText: string = parts[0].text;
        const contextId: string | undefined = (params as any)?.contextId;
        const agentName: string = (params as any)?.agentName || 'anonymous';

        // Execute via claude -p
        const response = await executePrompt(messageText, config.workspace, config.max_turns);

        // Save to DB
        saveMessage('inbound', agentName, messageText, response, contextId || null);

        return reply.send(
          jsonRpcResult(id, {
            message: {
              role: 'agent',
              parts: [{ text: response }],
            },
            contextId: contextId || randomUUID(),
          }),
        );
      }

      case 'message/sendStream': {
        return reply.send(jsonRpcError(id, -32601, 'Streaming not yet supported'));
      }

      default: {
        return reply.send(jsonRpcError(id, -32601, `Method not found: ${method}`));
      }
    }
  });
}
