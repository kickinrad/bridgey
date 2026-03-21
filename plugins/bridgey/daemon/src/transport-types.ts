import { z } from 'zod';

// --- Transport Registration ---

export const TransportRegisterSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  callback_url: z.string().url(),
  capabilities: z.array(z.enum(['reply', 'react', 'edit', 'download_attachment'])),
});

export const TransportUnregisterSchema = z.object({
  name: z.string().min(1),
});

export type TransportRegistration = z.infer<typeof TransportRegisterSchema> & {
  registered_at: string;
  healthy: boolean;
  last_ping?: string;
};

// --- Inbound Messages (Transport → Daemon) ---

export const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number(),
  url: z.string().url(),
});

export const InboundMessageSchema = z.object({
  transport: z.string().min(1),
  chat_id: z.string().min(1),
  sender: z.string().min(1),
  content: z.string(),
  meta: z.record(z.string(), z.string()),
  attachments: z.array(AttachmentSchema).optional(),
});

export type InboundMessage = z.infer<typeof InboundMessageSchema>;

// --- Outbound Replies (Channel Server → Daemon → Transport) ---

export const OutboundReplySchema = z.object({
  chat_id: z.string().min(1),
  text: z.string().min(1),
  reply_to: z.string().optional(),
  files: z.array(z.string()).max(10).optional(),
});

export type OutboundReply = z.infer<typeof OutboundReplySchema>;

// --- Channel Server Registration ---

export const ChannelRegisterSchema = z.object({
  push_url: z.string().url(),
});

// --- Chat ID Parsing ---

export function parseTransportFromChatId(chatId: string): string | null {
  const colonIndex = chatId.indexOf(':');
  if (colonIndex === -1) return null;
  return chatId.substring(0, colonIndex);
}
