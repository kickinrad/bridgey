import { describe, it, expect } from 'vitest'
import {
  TransportRegisterSchema,
  TransportUnregisterSchema,
  InboundMessageSchema,
  OutboundReplySchema,
  ChannelRegisterSchema,
  parseTransportFromChatId,
} from '../transport-types.js'

describe('TransportRegisterSchema', () => {
  it('validates a valid registration', () => {
    const result = TransportRegisterSchema.safeParse({
      name: 'discord',
      callback_url: 'http://localhost:8094',
      capabilities: ['reply', 'react'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const result = TransportRegisterSchema.safeParse({
      callback_url: 'http://localhost:8094',
      capabilities: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid callback_url', () => {
    const result = TransportRegisterSchema.safeParse({
      name: 'discord',
      callback_url: 'not-a-url',
      capabilities: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('InboundMessageSchema', () => {
  it('validates a Discord inbound message', () => {
    const result = InboundMessageSchema.safeParse({
      transport: 'discord',
      chat_id: 'discord:dm:123456',
      sender: 'Wils#1234',
      content: 'hello world',
      meta: { guild: 'my_server', channel: 'general' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional attachments', () => {
    const result = InboundMessageSchema.safeParse({
      transport: 'discord',
      chat_id: 'discord:dm:123',
      sender: 'user',
      content: 'check this file',
      meta: {},
      attachments: [{ id: 'att_1', name: 'file.png', type: 'image/png', size: 1024, url: 'https://cdn.discord.com/file.png' }],
    })
    expect(result.success).toBe(true)
  })
})

describe('OutboundReplySchema', () => {
  it('validates a basic reply', () => {
    const result = OutboundReplySchema.safeParse({
      chat_id: 'discord:dm:123456',
      text: 'hello back',
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional files and reply_to', () => {
    const result = OutboundReplySchema.safeParse({
      chat_id: 'discord:dm:123456',
      text: 'here you go',
      reply_to: 'msg_789',
      files: ['/tmp/result.png'],
    })
    expect(result.success).toBe(true)
  })
})

describe('ChannelRegisterSchema', () => {
  it('validates channel server registration', () => {
    const result = ChannelRegisterSchema.safeParse({
      push_url: 'http://127.0.0.1:54321',
    })
    expect(result.success).toBe(true)
  })
})

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
