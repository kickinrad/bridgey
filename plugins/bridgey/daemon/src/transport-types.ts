import { z } from 'zod';

// --- Transport Registration ---

export const TransportRegisterSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  callback_url: z.string().url(),
  capabilities: z.array(z.enum(['reply', 'react', 'edit', 'edit_message', 'fetch_messages', 'download_attachment', 'permission'])),
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
  meta: z.record(
    z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Meta keys must be identifiers (letters, digits, underscores). Hyphens are silently dropped by Claude Code.'),
    z.string(),
  ),
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

// --- Outbound Reactions (Channel Server → Daemon → Transport) ---

export const OutboundReactSchema = z.object({
  chat_id: z.string().min(1),
  message_id: z.string().min(1),
  emoji: z.string().min(1),
});

export type OutboundReact = z.infer<typeof OutboundReactSchema>;

// --- Channel Server Registration ---

export const ChannelRegisterSchema = z.object({
  agent_name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, {
    message: 'agent_name must start with a letter and contain only letters, digits, underscores, or hyphens',
  }),
  push_url: z.string().url(),
});

export const ChannelUnregisterSchema = z.object({
  agent_name: z.string().min(1),
});

// --- Outbound Edits (Channel Server → Daemon → Transport) ---

export const OutboundEditSchema = z.object({
  chat_id: z.string().min(1),
  message_id: z.string().min(1),
  text: z.string().min(1),
});

export type OutboundEdit = z.infer<typeof OutboundEditSchema>;

// --- Fetch Messages (Channel Server → Daemon → Transport) ---

export const FetchMessagesSchema = z.object({
  chat_id: z.string().min(1),
  limit: z.number().min(1).max(100).default(20),
});

// --- Download Attachment (Channel Server → Daemon → Transport) ---

export const DownloadAttachmentSchema = z.object({
  chat_id: z.string().min(1),
  message_id: z.string().min(1),
});

// --- Permission Relay ---

export const PermissionRequestSchema = z.object({
  request_id: z.string().min(1),
  tool_name: z.string().min(1),
  description: z.string(),
  input_preview: z.string(),
});

export const PermissionResponseSchema = z.object({
  request_id: z.string().regex(/^[a-km-z]{5}$/),
  behavior: z.enum(['allow', 'deny']),
});

// --- Chat ID Parsing ---

export function parseTransportFromChatId(chatId: string): string | null {
  const colonIndex = chatId.indexOf(':');
  if (colonIndex === -1) return null;
  return chatId.substring(0, colonIndex);
}
