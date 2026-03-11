import { z } from 'zod';
// POST /send body validation
export const SendBodySchema = z.object({
    agent: z.string().min(1, 'agent is required').max(100),
    message: z.string().min(1, 'message is required').max(10_000),
    context_id: z.string().max(200).optional(),
});
// JSON-RPC envelope validation
export const A2ARequestSchema = z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]),
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
});
// message/send params validation
export const MessageSendParamsSchema = z.object({
    message: z.object({
        role: z.string().default('user'),
        parts: z
            .array(z.object({
            text: z.string().min(1, 'part text is required'),
        }))
            .min(1, 'at least one part is required'),
    }),
    agentName: z.string().max(100).default('anonymous'),
    contextId: z.string().max(200).optional(),
});
