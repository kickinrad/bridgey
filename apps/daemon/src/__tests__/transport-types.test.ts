import { describe, it, expect } from 'vitest'
import {
  parseTransportFromChatId,
  TransportRegisterSchema,
  OutboundEditSchema,
  FetchMessagesSchema,
  DownloadAttachmentSchema,
  PermissionRequestSchema,
  PermissionResponseSchema,
} from '../transport-types.js'

describe('parseTransportFromChatId', () => {
  it('extracts transport name from chat_id', () => {
    expect(parseTransportFromChatId('discord:dm:123')).toBe('discord')
    expect(parseTransportFromChatId('a2a:julia:ctx_abc')).toBe('a2a')
    expect(parseTransportFromChatId('telegram:12345')).toBe('telegram')
  })

  it('returns null for invalid chat_id', () => {
    expect(parseTransportFromChatId('nocolehere')).toBeNull()
  })
})

describe('TransportRegisterSchema', () => {
  it('accepts new capability values', () => {
    const result = TransportRegisterSchema.safeParse({
      name: 'discord',
      callback_url: 'http://localhost:8094',
      capabilities: ['reply', 'react', 'edit_message', 'fetch_messages', 'download_attachment', 'permission'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown capabilities', () => {
    const result = TransportRegisterSchema.safeParse({
      name: 'discord',
      callback_url: 'http://localhost:8094',
      capabilities: ['unknown_cap'],
    })
    expect(result.success).toBe(false)
  })
})

describe('OutboundEditSchema', () => {
  it('validates a valid edit', () => {
    const result = OutboundEditSchema.safeParse({
      chat_id: 'discord:dm:123',
      message_id: '456',
      text: 'updated text',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty text', () => {
    const result = OutboundEditSchema.safeParse({
      chat_id: 'discord:dm:123',
      message_id: '456',
      text: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('FetchMessagesSchema', () => {
  it('defaults limit to 20', () => {
    const result = FetchMessagesSchema.parse({ chat_id: 'discord:ch:789' })
    expect(result.limit).toBe(20)
  })

  it('rejects limit over 100', () => {
    const result = FetchMessagesSchema.safeParse({ chat_id: 'discord:ch:789', limit: 200 })
    expect(result.success).toBe(false)
  })
})

describe('DownloadAttachmentSchema', () => {
  it('validates a valid download request', () => {
    const result = DownloadAttachmentSchema.safeParse({
      chat_id: 'discord:dm:123',
      message_id: '456',
    })
    expect(result.success).toBe(true)
  })
})

describe('PermissionRequestSchema', () => {
  it('validates a valid permission request', () => {
    const result = PermissionRequestSchema.safeParse({
      request_id: 'abcde',
      tool_name: 'Bash',
      description: 'Run npm test',
      input_preview: '{"command": "npm test"}',
    })
    expect(result.success).toBe(true)
  })
})

describe('PermissionResponseSchema', () => {
  it('accepts valid 5-letter request_id (no l)', () => {
    const result = PermissionResponseSchema.safeParse({
      request_id: 'abcde',
      behavior: 'allow',
    })
    expect(result.success).toBe(true)
  })

  it('rejects request_id containing l', () => {
    const result = PermissionResponseSchema.safeParse({
      request_id: 'abcle',
      behavior: 'allow',
    })
    expect(result.success).toBe(false)
  })

  it('rejects request_id with wrong length', () => {
    const result = PermissionResponseSchema.safeParse({
      request_id: 'abc',
      behavior: 'deny',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid behavior', () => {
    const result = PermissionResponseSchema.safeParse({
      request_id: 'abcde',
      behavior: 'maybe',
    })
    expect(result.success).toBe(false)
  })
})
