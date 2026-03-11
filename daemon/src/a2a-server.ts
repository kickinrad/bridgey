import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import type { BridgeyConfig, A2AResponse } from './types.js';
import { validateToken, isLocalAgent } from './auth.js';
import { generateAgentCard } from './agent-card.js';
import { executePrompt } from './executor.js';
import { AgentQueue } from './queue.js';
import { sendA2AMessage } from './a2a-client.js';
import { saveMessage, getMessages, getAgents, saveAgent, saveAuditEntry, getAuditLog, getOrCreateConversation } from './db.js';
import { listLocal } from './registry.js';
import { SendBodySchema, A2ARequestSchema, MessageSendParamsSchema } from './schemas.js';
import { RateLimiter } from './rate-limiter.js';

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
  const requestQueue = new AgentQueue();
  const agentCard = generateAgentCard(config);
  const rateLimiter = new RateLimiter({
    maxRequests: config.rate_limit?.max_requests ?? 10,
    windowMs: config.rate_limit?.window_ms ?? 60_000,
  });

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

  // Audit log: log every request except noisy endpoints
  fastify.addHook('onResponse', async (req, reply) => {
    const skipPaths = ['/health', '/.well-known/agent-card.json'];
    if (skipPaths.includes(req.url)) return;

    // Determine auth_type
    let auth_type = 'none';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      auth_type = 'bearer';
    } else if (isLocalAgent(req)) {
      auth_type = 'local';
    }

    // Extract a2a_method and agent_name from POST body
    let a2a_method: string | null = null;
    let agent_name: string | null = null;
    if (req.method === 'POST' && req.body) {
      const body = req.body as Record<string, unknown>;
      if (typeof body.method === 'string') {
        a2a_method = body.method;
      }
      if (typeof (body as any).agent === 'string') {
        agent_name = (body as any).agent;
      }
      // For A2A JSON-RPC, extract agentName from params
      if (!agent_name && body.params && typeof body.params === 'object') {
        const params = body.params as Record<string, unknown>;
        if (typeof params.agentName === 'string') {
          agent_name = params.agentName;
        }
      }
    }

    try {
      saveAuditEntry({
        source_ip: req.ip,
        method: req.method,
        path: req.url,
        a2a_method,
        agent_name,
        status_code: reply.statusCode,
        auth_type,
      });
    } catch {
      // Don't let audit logging failures break requests
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

  // Audit log endpoint
  fastify.get('/audit', async (req, reply) => {
    if (!validateToken(req, config) && !isLocalAgent(req)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const query = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 500);
    return reply.send(getAuditLog(limit));
  });

  // Internal send endpoint (used by MCP server)
  fastify.post('/send', async (req, reply) => {
    if (!validateToken(req, config) && !isLocalAgent(req)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const parsed = SendBodySchema.safeParse(req.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const { agent: agentName, message, context_id } = parsed.data;

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

    const conversation = getOrCreateConversation(context_id ?? null, agentName);
    const response = await sendA2AMessage(agentUrl, agentToken, message, conversation.id);
    saveMessage('outbound', agentName, message, response, conversation.id);

    return reply.send({ response });
  });

  // A2A JSON-RPC endpoint
  fastify.post('/', async (req, reply) => {
    // Auth check: skip for local agents
    if (!isLocalAgent(req) && !validateToken(req, config)) {
      return reply.code(401).send(jsonRpcError('0', -32000, 'Unauthorized'));
    }

    // Rate limit
    if (!rateLimiter.check(req.ip)) {
      return reply.code(429).send(jsonRpcError('0', -32000, 'Rate limit exceeded'));
    }

    const rpcParsed = A2ARequestSchema.safeParse(req.body);

    if (!rpcParsed.success) {
      return reply.code(400).send(jsonRpcError('0', -32600, 'Invalid JSON-RPC request'));
    }

    const { id, method, params } = rpcParsed.data;

    switch (method) {
      case 'message/send': {
        // Validate message/send params with Zod
        const paramsParsed = MessageSendParamsSchema.safeParse(params);
        if (!paramsParsed.success) {
          return reply.send(jsonRpcError(id, -32602, `Invalid params: ${paramsParsed.error.issues[0].message}`));
        }

        const messageText = paramsParsed.data.message.parts[0].text;
        const contextId = paramsParsed.data.contextId;
        const agentName = paramsParsed.data.agentName;

        // Track conversation
        const conversation = getOrCreateConversation(contextId ?? null, agentName);

        // Execute via claude -p (queued per-agent to prevent concurrent sessions)
        const response = await requestQueue.enqueue(agentName, () =>
          executePrompt(messageText, config.workspace, config.max_turns),
        );

        // Save to DB
        saveMessage('inbound', agentName, messageText, response, conversation.id);

        return reply.send(
          jsonRpcResult(id, {
            message: {
              role: 'agent',
              parts: [{ text: response }],
            },
            contextId: conversation.id,
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
