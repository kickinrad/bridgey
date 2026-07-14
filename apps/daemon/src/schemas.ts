import { z } from 'zod';

export const BridgeyConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  port: z.number().int().min(1).max(65535),
  bind: z.string().default('localhost'),
  token: z.string().min(1),
  workspace: z.string().default(''),
  max_turns: z.number().int().min(1).default(5),
  allowed_tools: z.array(z.string().min(1)).optional(),
  agents: z.array(z.object({
    name: z.string().min(1),
    url: z.string().url(),
    token: z.string().min(1),
  })).default([]),
  rate_limit: z.object({
    max_requests: z.number().int().min(1),
    window_ms: z.number().int().min(1),
  }).optional(),
  tls: z.object({
    cert: z.string().min(1),
    key: z.string().min(1),
    ca: z.string().optional(),
  }).optional(),
  trusted_networks: z.array(z.string()).optional(),
  identity_mode: z.enum(['bearer', 'tailscale', 'both']).default('bearer'),
  identity_allowlist: z.object({
    tailscale_users: z.array(z.string()).optional(),
    tailscale_nodes: z.array(z.string()).optional(),
  }).optional(),
  tailscale_sock: z.string().default('/run/tailscale/tailscaled.sock'),
});

// POST /send body validation
export const SendBodySchema = z.object({
  agent: z.string().min(1, 'agent is required').max(100),
  message: z.string().min(1, 'message is required').max(10_000),
  context_id: z.string().max(200).optional(),
});

export type SendBody = z.infer<typeof SendBodySchema>;

// JSON-RPC envelope validation
export const A2ARequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type A2ARequestParsed = z.infer<typeof A2ARequestSchema>;

// message/send params validation
export const MessageSendParamsSchema = z.object({
  message: z.object({
    role: z.string().default('user'),
    parts: z
      .array(
        z.object({
          text: z.string().min(1, 'part text is required'),
        }),
      )
      .min(1, 'at least one part is required'),
  }),
  agentName: z.string().max(100).default('anonymous'),
  contextId: z.string().max(200).optional(),
});

export type MessageSendParams = z.infer<typeof MessageSendParamsSchema>;
