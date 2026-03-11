import { z } from 'zod';
export declare const SendBodySchema: z.ZodObject<{
    agent: z.ZodString;
    message: z.ZodString;
    context_id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SendBody = z.infer<typeof SendBodySchema>;
export declare const A2ARequestSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type A2ARequestParsed = z.infer<typeof A2ARequestSchema>;
export declare const MessageSendParamsSchema: z.ZodObject<{
    message: z.ZodObject<{
        role: z.ZodDefault<z.ZodString>;
        parts: z.ZodArray<z.ZodObject<{
            text: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    agentName: z.ZodDefault<z.ZodString>;
    contextId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type MessageSendParams = z.infer<typeof MessageSendParamsSchema>;
